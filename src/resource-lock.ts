import { MODULE_ID } from "./constants";

// Ricart–Agrawala mutual exclusion: every active client acknowledges a request.
// Writes still run on the requesting client, with its own document permissions.
// Missing replies fail closed; a timer never expires a lock held by a writer.
interface Request {
  id: string;
  user: string;
  session: string;
  clock: number;
}
interface Message extends Request {
  kind: "hello" | "presence" | "request" | "reply" | "release";
  target?: string;
  peers?: Array<{ user: string; session: string }>;
}
const channel = `module.${MODULE_ID}`;
const incarnation = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
let session = incarnation;
const known = new Map<string, string>();
let clock = 0;
let serial = 0;
let queue: Promise<unknown> = Promise.resolve();
let registered = false;
let current:
  | {
      request: Request;
      held: boolean;
      waiting: Set<string>;
      users: Set<string>;
      ready: () => void;
    }
  | undefined;
const deferred = new Map<string, Request>();

function browserSession(): string {
  try {
    if (typeof sessionStorage === "undefined") return incarnation;
    const key = `${channel}.${game.user!.id}.session`;
    const navigation =
      typeof performance === "undefined"
        ? undefined
        : (performance.getEntriesByType("navigation")[0] as
            PerformanceNavigationTiming | undefined);
    // Keep the same participant across a reload, which does not always produce
    // a userDisconnected event. A new/duplicated tab gets a separate identity,
    // even when its initial sessionStorage was copied from the opener.
    const previous = sessionStorage.getItem(key);
    const identity =
      navigation?.type === "reload" && previous ? previous : incarnation;
    sessionStorage.setItem(key, identity);
    return identity;
  } catch {
    // Storage restrictions retain the conservative missing-reply behavior.
    return incarnation;
  }
}

function send(message: Message): void {
  game.socket!.emit(channel, message);
}
function reply(request: Request): void {
  send({
    ...request,
    kind: "reply",
    target: request.session,
    user: game.user!.id,
    session,
    peers: roster(),
  });
}
function earlier(a: Request, b: Request): boolean {
  return a.clock < b.clock || (a.clock === b.clock && a.session < b.session);
}
function roster(): Array<{ user: string; session: string }> {
  const active = new Set(
    Array.from(game.users ?? [])
      .filter((u) => u.active)
      .map((u) => u.id),
  );
  return [
    { user: game.user!.id, session },
    ...Array.from(known, ([session, user]) => ({ session, user })),
  ].filter((peer) => active.has(peer.user));
}
export function registerResourceLock(): void {
  if (registered || !game.socket || !game.user) return;
  session = browserSession();
  registered = true;
  game.socket.on(channel, (data: unknown) => {
    if (!data || typeof data !== "object" || !game.user) return;
    const m = data as Message;
    if (
      !["hello", "presence", "request", "reply", "release"].includes(m.kind) ||
      typeof m.id !== "string" ||
      typeof m.user !== "string" ||
      typeof m.session !== "string" ||
      !Number.isSafeInteger(m.clock) ||
      m.clock < 0 ||
      !Array.from(game.users).some((u) => u.id === m.user && u.active) ||
      m.session === session
    )
      return;
    known.set(m.session, m.user);
    clock = Math.max(clock, m.clock) + 1;
    if (m.kind === "hello") {
      send({
        id: m.id,
        user: game.user.id,
        session,
        clock: ++clock,
        kind: "presence",
        target: m.session,
        peers: roster(),
      });
      if (current && !current.held) {
        current.waiting.add(m.session);
        send({ ...current.request, kind: "request" });
      }
    } else if (m.kind === "presence") {
      if (m.target !== session) return;
      for (const peer of m.peers ?? [])
        if (peer.session !== session) known.set(peer.session, peer.user);
    } else if (m.kind === "reply") {
      if (m.target !== session || current?.request.id !== m.id) return;
      let discovered = false;
      const active = peers();
      active.add(game.user.id);
      for (const peer of m.peers ?? []) {
        if (peer.session === session || !active.has(peer.user)) continue;
        if (!known.has(peer.session)) {
          current.waiting.add(peer.session);
          discovered = true;
        }
        known.set(peer.session, peer.user);
      }
      current.waiting.delete(m.session);
      current.users.delete(m.user);
      if (discovered) send({ ...current.request, kind: "request" });
      if (!current.waiting.size && !current.users.size) current.ready();
    } else if (m.kind === "release") {
      deferred.delete(m.id);
    } else if (current && (current.held || earlier(current.request, m))) {
      deferred.set(m.id, m);
    } else reply(m);
  });
  // A browser session, rather than a User ID, is the participant identity. Two
  // sessions belonging to the same owner must also acknowledge one another.
  send({
    id: session,
    user: game.user!.id,
    session,
    clock: ++clock,
    kind: "hello",
  });
  Hooks.on("userConnected", (user: FoundryUser, connected: boolean) => {
    if (connected) return;
    for (const [id, userId] of known) if (userId === user.id) known.delete(id);
  });
}
function peers(): Set<string> {
  return new Set(
    Array.from(game.users ?? [])
      .filter((u) => u.active && u.id !== game.user?.id)
      .map((u) => u.id),
  );
}
function waitingClients(): string {
  const ids = new Set(current?.users);
  for (const pending of current?.waiting ?? []) {
    const userId = known.get(pending);
    if (userId) ids.add(userId);
  }
  return Array.from(ids, (id) => {
    const user = Array.from(game.users).find((user) => user.id === id);
    return `${user?.name ?? id}${id === game.user?.id ? " (another browser session)" : ""}`;
  }).join(", ");
}
async function locked<T>(action: () => Promise<T>): Promise<T> {
  if (!game.user)
    throw new Error("Sign in before changing Crew Tools resources.");
  const participants = peers();
  if (participants.size && !game.socket)
    throw new Error(
      "Crew Tools cannot coordinate this purchase. Reconnect before retrying.",
    );
  registerResourceLock();
  const request = {
    // Replies from the page before a reload must never satisfy a new request.
    id: `${incarnation}:${++serial}`,
    user: game.user.id,
    session,
    clock: ++clock,
  };
  const sessions = new Set(
    roster()
      .filter((peer) => peer.session !== session)
      .map((peer) => peer.session),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    current = {
      request,
      held: false,
      waiting: sessions,
      users: new Set(participants),
      ready: resolve,
    };
    if (!participants.size && !sessions.size) resolve();
    else
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Another client did not release or acknowledge the Crew Tools transaction. Waiting for: ${waitingClients()}. Wait for it to finish, or reconnect the unresponsive client, then retry.`,
            ),
          ),
        30000,
      );
  });
  try {
    if (participants.size || sessions.size)
      send({ ...request, kind: "request" });
    await ready;
    if (timer) clearTimeout(timer);
    // Membership changes during acquisition require a new round of acknowledgments.
    if (
      current!.waiting.size ||
      current!.users.size ||
      JSON.stringify([...peers()].sort()) !==
        JSON.stringify([...participants].sort())
    )
      throw new Error(
        "Connected users changed. Review the purchase and retry.",
      );
    current!.held = true;
    return await action();
  } finally {
    if (timer) clearTimeout(timer);
    current = undefined;
    if (game.socket) send({ ...request, kind: "release" });
    for (const request of deferred.values()) reply(request);
    deferred.clear();
  }
}
export function withResourceLock<T>(action: () => Promise<T>): Promise<T> {
  // Native Web Locks additionally cover a newly opened same-origin browser tab
  // before it has exchanged socket presence with other sessions.
  const run = queue.then(async (): Promise<T> =>
    typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request(channel, () => locked(action))
      : locked(action),
  );
  queue = run.catch(() => undefined);
  return run;
}
