import test from "node:test";
import assert from "node:assert/strict";
import { loadTransactionModule } from "./transaction-world.mjs";

test("HUD builds exclusions once, preserving GM and owner balances after roster edits", () => {
  let actorVisits = 0,
    journalReads = 0;
  const actors = Array.from({ length: 1000 }, (_, i) => ({
    id: "a" + i,
    type: "character",
    testUserPermission: () => i < 2,
  }));
  actors.get = (id) => actors.find((actor) => actor.id === id);
  actors[Symbol.iterator] = function* () {
    for (let i = 0; i < this.length; i++) {
      actorVisits++;
      yield this[i];
    }
  };
  const journals = Array.from({ length: 500 }, () => ({
    getFlag: () => {
      journalReads++;
      return undefined;
    },
    pages: [],
  }));
  const hub = { setAttribute() {}, classList: { toggle() {} } },
    row = { querySelector: () => hub },
    root = { querySelector: () => row };
  let excluded = [];
  const game = {
    actors,
    journal: journals,
    user: { isGM: true },
    settings: { get: () => excluded },
  };
  const api = loadTransactionModule(
    "crew-hud",
    game,
    {
      "./shortcut-display": { showHudShortcuts: () => true },
      "./window-controls": {},
      "./rent": { rentNeedsAttention: () => false },
      "./ui-refresh": {},
      "./downtime-store": {
        getIndex: () => ({
          accounts: Array.from({ length: 50 }, (_, i) => ({
            actorId: "a" + i,
          })),
        }),
      },
      "./downtime-records": { storedDowntimeBalance: () => 1 },
      "./payout-inbox": { waitingPayoutCount: () => 0 },
      "./player-settings": { addPlayerSettingsGear() {} },
    },
    { document: { getElementById: () => root } },
  );
  api.readyCrewHud();
  assert.equal(actorVisits, 1000);
  assert.equal(journalReads, 500);
  assert.match(hub.title, /50 unspent crew/);
  excluded = ["a0"];
  actorVisits = journalReads = 0;
  api.refreshCrewHud();
  assert.match(hub.title, /49 unspent crew/);
  game.user.isGM = false;
  actorVisits = journalReads = 0;
  api.refreshCrewHud();
  assert.equal(actorVisits, 1000);
  assert.equal(journalReads, 500);
  assert.match(hub.title, /1 unspent downtime/);
});

test("HQ refresh ignores unrelated actor changes, coalesces bursts, and writes only changed permissions", async () => {
  const hooks = new Map(),
    queue = [];
  let reads = 0,
    writes = 0,
    allowed = true;
  const users = [
    { id: "gm", isGM: true },
    { id: "player", isGM: false },
  ];
  const item = {
    type: "netarch",
    ownership: { player: 2, default: 0 },
    getFlag: () => "hq",
    async update(changes) {
      writes++;
      Object.assign(this.ownership, changes.ownership);
      for (const key of Object.keys(changes)) {
        if (key.startsWith("ownership.-="))
          delete this.ownership[key.slice(12)];
      }
    },
  };
  const game = {
    user: users[0],
    users,
    items: [item],
    actors: new Map([["a", { testUserPermission: () => allowed }]]),
  };
  const hqs = [{ id: "hq", actorId: "a" }];
  const api = loadTransactionModule(
    "hq-server-room",
    game,
    {
      "./headquarters": { getHeadquarters: () => ({ headquarters: hqs }) },
      "./hq-records": {
        hqPage: () => {
          reads++;
          return { testUserPermission: () => true };
        },
      },
      "./hq-benefits": { improvementLevel: () => 1 },
      "./action-coordinator": {
        isPrimaryGM: () => game.user.isGM,
        queueAction: (fn) => {
          queue.push(fn);
          return Promise.resolve();
        },
      },
    },
    {
      Hooks: {
        on: (name, fn) => hooks.set(name, fn),
        once: (name, fn) => hooks.set(name, fn),
      },
    },
  );
  api.registerServerRooms();
  for (let i = 0; i < 100; i++)
    hooks.get("updateActor")(
      { id: "a" },
      { "system.derivedStats.hp.value": i },
    );
  assert.equal(reads, 0);
  assert.equal(queue.length, 0);
  for (let i = 0; i < 100; i++) hooks.get("updateUser")();
  assert.equal(queue.length, 1);
  await queue.shift()();
  assert.equal(writes, 0);
  allowed = false;
  hooks.get("updateActor")({ id: "a" }, { ownership: { player: 0 } });
  await queue.shift()();
  assert.equal(writes, 1);
  assert.equal(item.ownership.player, 0);
  await api.ensureServerRooms();
  assert.equal(writes, 1);
  game.user = users[1];
  reads = 0;
  hooks.get("updateActor")({ id: "a" }, { ownership: { player: 3 } });
  assert.equal(reads, 0);
  game.user = users[0];
  hqs.length = 0;
  await api.ensureServerRooms();
  assert.equal(writes, 1, "Inactive room already denied needs no write");
  item.ownership.deletedUser = 2;
  await api.ensureServerRooms();
  assert.equal(item.ownership.deletedUser, undefined);
  assert.equal(writes, 2);
  await api.ensureServerRooms();
  assert.equal(
    writes,
    2,
    "Removed user permissions do not cause perpetual writes",
  );
});
