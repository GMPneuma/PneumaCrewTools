import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";
import {
  loadTransactionModule,
  socketWorld,
  tick,
} from "./transaction-world.mjs";

function fixture() {
  const user = { id: "gm", name: "GM", isGM: true, active: true };
  const game = {
    user,
    users: [user],
    actors: new Map([["tech", { id: "tech", name: "Tech" }]]),
  };
  const flags = {
    techAttempt: {
      requestId: "request1",
      projectId: "project1",
      action: "Mark project Item",
      sourceUuid: "Actor.tech.Item.source",
      destinationActorId: "container",
      destinationItemId: "reference",
    },
  };
  const writes = [];
  let fail = false;
  const ledger = {
    id: "ledger",
    text: { content: "before" },
    getFlag: (_ns, key) => flags[key],
    async update(data) {
      writes.push(structuredClone(data));
      if (fail) throw Error("write failed");
      for (const [key, value] of Object.entries(data))
        if (key.startsWith("flags.pneuma-crewtools."))
          flags[key.split(".").at(-1)] = structuredClone(value);
      ledger.text.content = data["text.content"];
    },
  };
  const state = {
    accounts: [{ actorId: "tech" }],
    events: [{ id: "existing", days: 1 }],
    activities: [{ id: "project1", status: "active", progress: { value: 1 } }],
  };
  const locks = loadTransactionModule("resource-lock", game);
  locks.registerResourceLock();
  const api = loadTransactionModule("tech-recovery", game, {
    "./resource-lock": locks,
    "./downtime-store": {
      actorLedger: (id) => (id === "tech" ? ledger : undefined),
      getDowntime: () => structuredClone(state),
      ledgerHtml: (_state, overrides) => JSON.stringify(overrides),
    },
  });
  return {
    api,
    game,
    flags,
    ledger,
    writes,
    state,
    fail: () => {
      fail = true;
    },
    expected: () => structuredClone(flags.techAttempt),
  };
}
test("GM clearing preserves the exact attempt and review note in one update without changing project resources", async () => {
  const f = fixture(),
    before = structuredClone(f.state),
    expected = f.expected();
  await f.api.clearInterruptedTechAttempt(
    "tech",
    expected,
    "Original restored; reference removed; project reviewed",
  );
  assert.equal(f.flags.techAttempt, null);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.flags.techRecoveries[0].attempt, expected);
  assert.equal(f.flags.techRecoveries[0].gmId, "gm");
  assert.match(f.flags.techRecoveries[0].note, /Original restored/);
  assert.deepEqual(f.state, before);
  assert.ok(f.ledger.text.content.includes("techRecoveries"));
});
test("players, changed attempts, empty notes and missing character logs cannot clear a blocker", async () => {
  const f = fixture(),
    expected = f.expected();
  f.game.user.isGM = false;
  await assert.rejects(
    f.api.clearInterruptedTechAttempt("tech", expected, "Reviewed"),
    /GM/,
  );
  f.game.user.isGM = true;
  await assert.rejects(
    f.api.clearInterruptedTechAttempt(
      "tech",
      { ...expected, requestId: "older" },
      "Reviewed",
    ),
    /attempt changed/,
  );
  await assert.rejects(
    f.api.clearInterruptedTechAttempt("tech", expected, " "),
    /review note/,
  );
  await assert.rejects(
    f.api.clearInterruptedTechAttempt("missing", expected, "Reviewed"),
    /Log is missing/,
  );
  f.flags.techRecoveries = { invalid: true };
  await assert.rejects(
    f.api.clearInterruptedTechAttempt("tech", expected, "Reviewed"),
    /history is invalid/,
  );
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.flags.techAttempt, expected);
});
test("failed clear retains the blocker and existing history; a completed clear cannot be repeated", async () => {
  const f = fixture(),
    expected = f.expected();
  f.flags.techRecoveries = [{ note: "Previous review" }];
  f.fail();
  await assert.rejects(
    f.api.clearInterruptedTechAttempt("tech", expected, "Reviewed"),
    /write failed/,
  );
  assert.deepEqual(f.flags.techAttempt, expected);
  assert.equal(f.flags.techRecoveries.length, 1);
  const g = fixture(),
    snapshot = g.expected();
  await g.api.clearInterruptedTechAttempt("tech", snapshot, "Reviewed");
  await assert.rejects(
    g.api.clearInterruptedTechAttempt("tech", snapshot, "Reviewed"),
    /attempt changed/,
  );
  assert.equal(g.flags.techRecoveries.length, 1);
});
test("recovery waits for a competing client and rejects a replaced blocker after acquiring the lock", async () => {
  const f = fixture(),
    gm = f.game.user,
    player = { id: "player", active: true, isGM: false };
  const other = { user: player, users: [gm, player] };
  f.game.users = other.users;
  socketWorld([f.game, other]);
  const gmLock = loadTransactionModule("resource-lock", f.game),
    playerLock = loadTransactionModule("resource-lock", other);
  gmLock.registerResourceLock();
  playerLock.registerResourceLock();
  await tick();
  const api = loadTransactionModule("tech-recovery", f.game, {
    "./resource-lock": gmLock,
    "./downtime-store": {
      actorLedger: () => f.ledger,
      getDowntime: () => f.state,
      ledgerHtml: () => "",
    },
  });
  let release;
  const held = playerLock.withResourceLock(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await tick();
  const clearing = api.clearInterruptedTechAttempt(
    "tech",
    f.expected(),
    "Reviewed",
  );
  const rejected = assert.rejects(clearing, /attempt changed/);
  await tick();
  assert.equal(f.writes.length, 0);
  f.flags.techAttempt = { requestId: "new-operation" };
  release();
  await held;
  await rejected;
  assert.equal(f.flags.techAttempt.requestId, "new-operation");
  assert.equal(f.writes.length, 0);
});
test("Downtime recovery button appears only for a GM with a blocker", () => {
  const render = Handlebars.compile(
    fs.readFileSync("static/templates/downtime.hbs", "utf8"),
  );
  assert.match(
    render({ isGM: true, hasTechBlocker: true }),
    /data-tech-recovery/,
  );
  assert.doesNotMatch(
    render({ isGM: false, hasTechBlocker: true }),
    /data-tech-recovery/,
  );
  assert.doesNotMatch(
    render({ isGM: true, hasTechBlocker: false }),
    /data-tech-recovery/,
  );
});
