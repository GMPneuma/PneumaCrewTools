import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadTransactionModule,
  socketWorld,
  tick,
} from "./transaction-world.mjs";

function clients(count = 3, globals) {
  const users = Array.from({ length: count }, (_, i) => ({
    id: `player${i}`,
    active: true,
    isGM: false,
  }));
  const games = users.map((user) => ({ user, users }));
  socketWorld(games);
  const locks = games.map((game) =>
    loadTransactionModule("resource-lock", game, {}, globals),
  );
  locks.forEach((lock) => lock.registerResourceLock());
  return { locks, games, users };
}
test("simultaneous owners serialize shared resources without an online GM", async () => {
  const { locks } = clients();
  let balance = 100,
    active = 0,
    maximum = 0;
  await Promise.all(
    locks.map((lock) =>
      lock.withResourceLock(async () => {
        maximum = Math.max(maximum, ++active);
        const before = balance;
        await tick();
        balance = before - 20;
        active--;
      }),
    ),
  );
  assert.equal(balance, 40);
  assert.equal(maximum, 1);
});
test("exceptions release the distributed lock and local queued work continues", async () => {
  const { locks } = clients(2);
  const results = await Promise.allSettled([
    locks[0].withResourceLock(async () => {
      await tick();
      throw Error("purchase failed");
    }),
    locks[1].withResourceLock(async () => "next purchase"),
    locks[0].withResourceLock(async () => "retry"),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].value, "next purchase");
  assert.equal(results[2].value, "retry");
});
test("a refreshed browser can acknowledge transactions without its obsolete session blocking", async () => {
  const timers = new Map();
  let timerId = 0;
  const stored = new Map();
  const globals = {
    performance: { getEntriesByType: () => [{ type: "reload" }] },
    sessionStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const users = [
    { id: "gm", active: true, isGM: true },
    { id: "player", active: true, isGM: false },
  ];
  const gm = { user: users[0], users };
  const player = { user: users[1], users };
  const world = socketWorld([gm, player]);
  const gmLock = loadTransactionModule("resource-lock", gm, {}, globals);
  let playerLock = loadTransactionModule("resource-lock", player, {}, globals);
  gmLock.registerResourceLock();
  playerLock.registerResourceLock();
  await tick();
  // A reload can retain active User membership while replacing the JS runtime.
  world.disconnect(player);
  const refreshed = { user: users[1], users };
  world.connect(refreshed);
  playerLock = loadTransactionModule("resource-lock", refreshed, {}, globals);
  playerLock.registerResourceLock();
  await tick();
  let status = "waiting";
  const pending = gmLock
    .withResourceLock(async () => "HQ purchase")
    .then(
      () => (status = "fulfilled"),
      () => (status = "rejected"),
    );
  await tick();
  for (const timeout of timers.values()) timeout();
  await pending;
  assert.equal(status, "fulfilled");
});
test("duplicating a tab with copied session storage keeps distinct lock participants", async () => {
  const owner = { id: "same-owner", active: true, isGM: false };
  const games = [
    { user: owner, users: [owner] },
    { user: owner, users: [owner] },
  ];
  socketWorld(games);
  const stored = new Map();
  function browserGlobals(storage) {
    return {
      performance: { getEntriesByType: () => [{ type: "navigate" }] },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    };
  }
  const first = loadTransactionModule(
    "resource-lock",
    games[0],
    {},
    browserGlobals(stored),
  );
  first.registerResourceLock();
  const second = loadTransactionModule(
    "resource-lock",
    games[1],
    {},
    browserGlobals(new Map(stored)),
  );
  second.registerResourceLock();
  await tick();
  let writers = 0,
    maximum = 0;
  await Promise.all(
    [first, second].map((lock) =>
      lock.withResourceLock(async () => {
        maximum = Math.max(maximum, ++writers);
        await tick();
        writers--;
      }),
    ),
  );
  assert.equal(maximum, 1);
});

test("a GM alone can acquire a transaction without a socket or another client", async () => {
  const user = { id: "gm", active: true, isGM: true };
  const lock = loadTransactionModule("resource-lock", { user, users: [user] });
  assert.equal(await lock.withResourceLock(async () => "saved"), "saved");
});
test("two browser sessions for the same owner serialize against each other", async () => {
  const owner = { id: "same-owner", active: true, isGM: false };
  const games = [
    { user: owner, users: [owner] },
    { user: owner, users: [owner] },
  ];
  socketWorld(games);
  const locks = games.map((game) =>
    loadTransactionModule("resource-lock", game),
  );
  locks.forEach((lock) => lock.registerResourceLock());
  await tick();
  let value = 0;
  await Promise.all(
    locks.map((lock) =>
      lock.withResourceLock(async () => {
        const before = value;
        await tick();
        value = before + 1;
      }),
    ),
  );
  assert.equal(value, 2);
});
test("a missing client reply times out without executing or expiring another writer", async () => {
  const timers = new Map();
  let timerId = 0;
  const globals = {
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const { locks, games } = clients(2, globals);
  games[0].user.name = "Alex";
  let finish;
  const held = locks[0].withResourceLock(
    () => new Promise((resolve) => (finish = resolve)),
  );
  await tick();
  let writes = 0;
  const waiting = locks[1].withResourceLock(async () => {
    writes++;
  });
  const rejected = assert.rejects(
    waiting,
    /did not release or acknowledge.*Waiting for: Alex/,
  );
  await tick();
  assert.equal(timers.size, 1, "no timer can release a held lock");
  [...timers.values()][0]();
  await rejected;
  assert.equal(writes, 0);
  assert.equal(games[0].user.isGM, false);
  finish();
  await held;
  await locks[1].withResourceLock(async () => {
    writes++;
  });
  assert.equal(writes, 1);
});
test("IP purchases in independent owner clients cannot upgrade two skills for one debit", async () => {
  const { games, locks } = clients(2);
  const actor = {
    id: "actor",
    testUserPermission: () => true,
    items: ["Accounting", "Acting"].map((name, id) => ({
      id: String(id),
      name,
      type: "skill",
      system: { level: 0 },
    })),
    system: { improvementPoints: { value: 1000, transactions: [] } },
    async update(update) {
      await tick();
      for (const item of update.items)
        actor.items.find((i) => i.id === item._id).system.level =
          item["system.level"];
      actor.system.improvementPoints.value =
        update["system.improvementPoints.value"];
      actor.system.improvementPoints.transactions = structuredClone(
        update["system.improvementPoints.transactions"],
      );
    },
  };
  const api = games.map((game, i) =>
    loadTransactionModule("ip-spending", game, { "./resource-lock": locks[i] }),
  );
  const drafts = api.map((a, index) =>
    a
      .actorUpgrades(actor)
      .map((d) => ({ ...d, to: d.id === String(index) ? 1 : d.from })),
  );
  const results = await Promise.allSettled(
    api.map((a, i) => a.applyIpUpgrades(actor, drafts[i], 1000)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(actor.system.improvementPoints.value, 980);
  assert.equal(
    actor.items.reduce((sum, i) => sum + i.system.level, 0),
    1,
  );
  assert.equal(actor.system.improvementPoints.transactions.length, 1);
  const rejected = results.findIndex((r) => r.status === "rejected");
  assert.match(results[rejected].reason.message, /IP changed/);
  const retry = api[rejected]
    .actorUpgrades(actor)
    .map((d) => ({ ...d, to: d.id === String(rejected) ? 1 : d.from }));
  await api[rejected].applyIpUpgrades(actor, retry, 980);
  assert.equal(actor.system.improvementPoints.value, 960);
  assert.equal(actor.system.improvementPoints.transactions.length, 2);
});
