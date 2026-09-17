import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { journalWorld } from "./journal-world.mjs";
function fixture() {
  let sequence = 0;
  const sender = { id: "sender", name: "Sender", isGM: false, active: true },
    recipient = {
      id: "recipient",
      name: "Recipient",
      isGM: false,
      active: true,
    },
    stranger = { id: "stranger", name: "Stranger", isGM: false, active: true };
  const makeActor = (id, user) => ({
    id,
    name: id,
    type: "character",
    uuid: "Actor." + id,
    items: [],
    testUserPermission: (u) => u?.isGM || u?.id === user.id,
    getFlag: () => undefined,
    async createEmbeddedDocuments(_type, data) {
      return data.map((d) => {
        if (this.items.some((i) => i.id === d._id))
          throw Error("duplicate item");
        const item = makeItem(
          d._id ?? "item" + ++sequence,
          d.name,
          d.system.amount,
          this,
        );
        this.items.push(item);
        return item;
      });
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.items = this.items.filter((i) => !ids.includes(i.id));
    },
  });
  function makeItem(id, name, amount, actor) {
    return {
      id,
      name,
      type: "drug",
      system: { amount, description: "native item" },
      toObject() {
        return {
          _id: id,
          name,
          type: "drug",
          system: structuredClone(this.system),
        };
      },
      async snort() {
        assert.equal(actor.id, "target");
        if (actor.cancelConsume) return;
        this.system.amount -= 1;
        actor.consumed = (actor.consumed ?? 0) + 1;
      },
      async update(data) {
        assert.equal(game.user.id, sender.id);
        this.system.amount = data["system.amount"];
      },
    };
  }
  const source = makeActor("source", sender),
    target = makeActor("target", recipient),
    other = makeActor("other", stranger);
  source.items.push(
    { id: "role", name: "Medtech", type: "role", system: { rank: 4 } },
    makeItem("drug", "Antibiotic", 5, source),
    { id: "street", name: "Synthcoke", type: "drug", system: { amount: 2 } },
  );
  const game = {
    user: { id: "gm", isGM: true },
    users: [sender, recipient, stranger],
    actors: [source, target, other],
    messages: [],
    settings: { get: () => [] },
  };
  const hooks = new Map();
  const globals = {
    game,
    ...journalWorld(game),
    FormApplication: class {},
    Hooks: {
      on(name, fn) {
        const callbacks = hooks.get(name) ?? [];
        callbacks.push(fn);
        hooks.set(name, callbacks);
      },
      once() {},
    },
    document: { createElement: () => ({ textContent: "" }) },
    foundry: {
      utils: { randomID: () => String(++sequence).padStart(16, "a") },
    },
    ui: { notifications: { warn() {}, error() {}, info() {} } },
    ChatMessage: {
      async create(data) {
        const message = {
          ...structuredClone(data),
          author: game.user,
          async delete() {
            const index = game.messages.indexOf(this);
            if (index >= 0) game.messages.splice(index, 1);
          },
          async update(changes) {
            if ("flags.pneuma-crewtools.pharmaOffer.-=item" in changes)
              delete this.flags["pneuma-crewtools"].pharmaOffer.item;
          },
          getFlag(ns, key) {
            return this.flags?.[ns]?.[key];
          },
        };
        game.messages.push(message);
        return message;
      },
    },
  };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {};
    cache[name] = exports;
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        require: (k) =>
          k === "./calendar"
            ? { getCampaignDate: () => "2078-02-06" }
            : load(k.slice(2)),
        structuredClone,
        console,
        ...globals,
      },
    );
    return exports;
  }
  async function setup() {
    for (const actor of [source, target]) {
      const j = await load("journal-records").ensureActorPayoutJournal(actor);
      const create = j.createEmbeddedDocuments.bind(j);
      j.createEmbeddedDocuments = async (type, data, options) => {
        for (const d of data)
          if (d._id && j.pages.some((p) => p.id === d._id))
            throw Error("duplicate receipt");
        const pages = await create(type, data);
        pages.forEach((p, i) => {
          if (options?.keepId) p.id = data[i]._id;
        });
        return pages;
      };
    }
    game.user = sender;
  }
  return {
    game,
    source,
    target,
    other,
    sender,
    recipient,
    stranger,
    load,
    setup,
    emit: (name, ...args) => hooks.get(name)?.forEach((fn) => fn(...args)),
    api: load("pharma-transfer"),
    offer: () =>
      game.messages.find((m) => m.getFlag("pneuma-crewtools", "pharmaOffer")),
  };
}
test("Medtech lists only pharma; transfers require ownership, valid quantities and eligible targets", async () => {
  const f = fixture();
  await f.setup();
  assert.equal(
    f.load("pharmaceuticals").pharmaceuticalInventory(f.source).length,
    1,
  );
  for (const count of [0, -1, 1.5, 6])
    await assert.rejects(
      f.api.offerPharma("source", "drug", "target", count),
      /doses/,
    );
  await assert.rejects(
    f.api.offerPharma("source", "street", "target", 1),
    /doses/,
  );
  await assert.rejects(
    f.api.offerPharma("source", "drug", "source", 1),
    /another/,
  );
  f.game.user = f.stranger;
  await assert.rejects(
    f.api.offerPharma("source", "drug", "target", 1),
    /owned/,
  );
  assert.equal(f.source.items.find((i) => i.id === "drug").system.amount, 5);
});
test("Use Now works without a GM and cannot deliver twice", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 2);
  assert.equal(f.source.items.find((i) => i.id === "drug").system.amount, 3);
  const message = f.offer();
  assert.match(message.content, /Use Now.*Reject/);
  f.game.user = f.stranger;
  await assert.rejects(f.api.respondToPharma(message), /own/);
  f.game.user = f.recipient;
  await f.api.respondToPharma(message, "consume");
  assert.equal(f.target.items.length, 1);
  assert.equal(f.target.items[0].system.amount, 1);
  await f.api.respondToPharma(message, "consume");
  assert.equal(f.target.items.length, 1);
  await assert.rejects(
    f.api.respondToPharma(message, "reject"),
    /already answered/,
  );
  const receipt = f.load("journal-records").actorPayoutJournal("target")
    .pages[0];
  assert.match(receipt.text.content, /consumed/);
  f.target.items = [];
  await f.api.respondToPharma(message, "consume");
  assert.equal(f.target.items.length, 0);
});
test("Consume adds doses to inventory and invokes native drug consumption once", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 5);
  assert.equal(
    f.source.items.some((i) => i.id === "drug"),
    false,
  );
  f.game.user = f.recipient;
  await f.api.respondToPharma(f.offer(), "consume");
  assert.equal(f.target.items.length, 1);
  assert.equal(f.target.items[0].system.amount, 4);
  assert.equal(f.target.consumed, 1);
  await f.api.respondToPharma(f.offer(), "consume");
  assert.equal(f.target.consumed, 1);
  assert.match(
    f.load("journal-records").actorPayoutJournal("target").pages[0].text
      .content,
    /consumed/,
  );
  await assert.rejects(
    f.api.respondToPharma(f.offer(), "reject"),
    /already answered/,
  );
});
test("Reject waits for sender ownership to return doses, then returns them exactly once", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 3);
  f.game.user = f.recipient;
  await f.api.respondToPharma(f.offer(), "reject");
  await f.api.reconcilePharmaResponses();
  assert.equal(
    f.source.items
      .filter((i) => i.type === "drug" && i.name === "Antibiotic")
      .reduce((sum, i) => sum + i.system.amount, 0),
    2,
  );
  assert.equal(f.target.items.length, 0);
  f.game.user = f.sender;
  await f.api.reconcilePharmaResponses();
  await f.api.reconcilePharmaResponses();
  assert.equal(
    f.source.items
      .filter((i) => i.type === "drug" && i.name === "Antibiotic")
      .reduce((sum, i) => sum + i.system.amount, 0),
    5,
  );
  assert.match(
    f
      .load("journal-records")
      .recordPage(
        f.load("journal-records").actorPayoutJournal("source"),
        "pharmaTransfers",
      ).text.content,
    /returned/,
  );
});
test("Missing recipient Journal prevents withdrawing doses", async () => {
  const f = fixture();
  await f.setup();
  f.game.journal.delete(
    f.load("journal-records").actorPayoutJournal("target").id,
  );
  await assert.rejects(
    f.api.offerPharma("source", "drug", "target", 1),
    /prepared/,
  );
  assert.equal(f.source.items.find((i) => i.id === "drug").system.amount, 5);
});

test("Cancelling native use rejects and returns the dose instead of keeping it", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 1);
  f.target.cancelConsume = true;
  f.game.user = f.recipient;
  await f.api.respondToPharma(f.offer(), "consume");
  assert.equal(f.target.items.length, 0);
  assert.equal(
    f.game.messages.at(-1).getFlag("pneuma-crewtools", "pharmaResponse").choice,
    "reject",
  );
  f.game.user = f.sender;
  await f.api.reconcilePharmaResponses();
  await f.api.reconcilePharmaResponses();
  assert.equal(
    f.source.items
      .filter((i) => i.name === "Antibiotic")
      .reduce((n, i) => n + i.system.amount, 0),
    5,
  );
});
test("Interrupted delivery retains a durable receipt and cannot create duplicate inventory", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 2);
  f.game.user = f.recipient;
  const create = f.target.createEmbeddedDocuments.bind(f.target);
  f.target.createEmbeddedDocuments = async () => {
    throw Error("interrupted");
  };
  await assert.rejects(f.api.respondToPharma(f.offer()), /interrupted/);
  f.target.createEmbeddedDocuments = create;
  await assert.rejects(
    f.api.respondToPharma(f.offer()),
    /interrupted delivery/,
  );
  assert.equal(f.target.items.length, 0);
});

test("Multiple administrations share one table and keep earlier receipt guards", async () => {
  const f = fixture();
  await f.setup();
  const offers = [];
  for (const choice of ["consume", "consume", "reject"]) {
    f.game.user = f.sender;
    await f.api.offerPharma("source", "drug", "target", 1);
    const offer = f.game.messages.findLast((m) =>
      m.getFlag("pneuma-crewtools", "pharmaOffer"),
    );
    offers.push(offer);
    f.game.user = f.recipient;
    await f.api.respondToPharma(offer, choice);
    f.game.user = f.sender;
    await f.api.reconcilePharmaResponses();
  }
  const journals = f.load("journal-records");
  for (const id of ["source", "target"]) {
    const pages = journals.actorPayoutJournal(id).pages;
    assert.equal(pages.length, 1);
    assert.equal(pages[0].name, "Administer Pharma");
    assert.equal(pages[0].getFlag("pneuma-crewtools", "data").length, 3);
    assert.equal((pages[0].text.content.match(/<table/g) ?? []).length, 1);
  }
  f.game.user = f.recipient;
  f.target.items = [];
  await f.api.respondToPharma(offers[0], "consume");
  await f.api.respondToPharma(offers[1], "consume");
  assert.equal(f.target.items.length, 0);
  assert.equal(f.target.consumed, 2);
});

test("Pharma offers expose only Use Now and Reject and reject the removed choice", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 1);
  assert.doesNotMatch(f.offer().content, /Keep|data-pharma-choice="accept"/);
  f.game.user = f.recipient;
  await assert.rejects(
    f.api.respondToPharma(f.offer(), "accept"),
    /Use Now or Reject/,
  );
  assert.equal(f.target.items.length, 0);
});

test("completed Pharma receipts discard snapshots; pending transfers retain them; reconciliation scans chat once", async () => {
  const f = fixture();
  await f.setup();
  await f.api.offerPharma("source", "drug", "target", 1);
  const rows = (id) =>
    f.load("journal-records").actorPayoutRecords(id, "pharmaTransfers");
  assert.ok(rows("source")[0].item);
  f.game.user = f.recipient;
  await f.api.respondToPharma(f.offer(), "consume");
  assert.equal(rows("target")[0].item, undefined);
  assert.ok(rows("source")[0].item);
  f.game.user = f.sender;
  let scans = 0;
  const messages = f.game.messages;
  messages[Symbol.iterator] = function* () {
    scans++;
    for (let i = 0; i < this.length; i++) yield this[i];
  };
  await f.api.reconcilePharmaResponses();
  assert.equal(scans, 1);
  assert.equal(rows("source")[0].item, undefined);
  assert.equal(rows("source")[0].status, "consumed");
  assert.equal(
    f.offer().getFlag("pneuma-crewtools", "pharmaOffer").item,
    undefined,
  );
  f.game.user = f.recipient;
  await f.api.respondToPharma(f.offer(), "consume");
  assert.equal(f.target.consumed, 1);
});

function renderOffer(f, id = "offer") {
  const button = {
    dataset: { pharmaChoice: "consume" },
    addEventListener() {},
  };
  f.emit(
    "renderChatMessage",
    {
      getFlag: () => ({ id, targetId: "target" }),
    },
    [{ querySelectorAll: () => [button], querySelector: () => null }],
  );
  return button.disabled;
}

test("pharma chat renders share one history scan until messages change", () => {
  const f = fixture();
  f.api.registerPharmaTransfers();
  f.game.user = f.recipient;
  let reads = 0;
  f.game.messages = Array.from({ length: 1000 }, () => ({
    getFlag() {
      reads++;
    },
  }));
  for (let n = 0; n < 100; n++) assert.equal(renderOffer(f), false);
  assert.equal(reads, 1000);
  f.emit("updateChatMessage", f.game.messages[0]);
  for (let n = 0; n < 100; n++) renderOffer(f);
  assert.equal(reads, 2000);
});

test("pharma render cache follows response creation, edits, removal and ownership", async () => {
  const f = fixture();
  f.api.registerPharmaTransfers();
  f.game.user = f.recipient;
  assert.equal(renderOffer(f), false);
  let receipt = { id: "offer", targetId: "target", choice: "consume" };
  const message = { author: f.recipient, getFlag: () => receipt };
  f.game.messages.push(message);
  f.emit("createChatMessage", message);
  await f.load("action-coordinator").queueAction(async () => {});
  assert.equal(renderOffer(f), true);
  receipt = { ...receipt, id: "different" };
  f.emit("updateChatMessage", message);
  assert.equal(renderOffer(f), false);
  receipt.id = "offer";
  f.emit("updateChatMessage", message);
  assert.equal(renderOffer(f), true);
  f.game.messages.length = 0;
  f.emit("deleteChatMessage", message);
  assert.equal(renderOffer(f), false);
  f.game.messages.push(message);
  f.emit("updateChatMessage", message);
  assert.equal(renderOffer(f), true);
  f.game.user = { id: "gm", isGM: true };
  f.target.testUserPermission = (u) => u.isGM;
  f.emit("updateActor", f.target, { ownership: { recipient: 0 } });
  assert.equal(renderOffer(f), false);
  message.author.isGM = true;
  f.emit("updateUser", message.author);
  assert.equal(renderOffer(f), true);
});

async function cleanupFixture(count = 52) {
  const f = fixture();
  await f.setup();
  f.game.user = { id: "gm", isGM: true };
  const store = f.load("journal-records");
  const rows = (id) => store.actorPayoutRecords(id, "pharmaTransfers");
  const write = (actor, data) =>
    store.writeRecord(
      store.actorPayoutJournal(actor.id),
      "pharmaTransfers",
      "Administer Pharma",
      data,
      "",
    );
  const sent = Array.from({ length: count }, (_, n) => ({
    id: String(n).padStart(16, "a"),
    sourceId: "source",
    sourceName: "source",
    targetId: "target",
    targetName: "target",
    senderId: "sender",
    itemId: "drug",
    itemName: "Antibiotic",
    amount: 1,
    date: "2078-02-06",
    status: n % 2 ? "returned" : "consumed",
    direction: "sent",
  }));
  const received = sent.map((t) => ({
    ...t,
    direction: "received",
    status: t.status === "returned" ? "rejected" : "consumed",
  }));
  await write(f.source, sent);
  await write(f.target, received);
  for (const t of sent) {
    for (const flags of [
      { pharmaOffer: { ...t, status: "offered" } },
      {
        pharmaResponse: {
          id: t.id,
          targetId: t.targetId,
          choice: t.status === "returned" ? "reject" : "consume",
        },
      },
    ]) {
      f.game.messages.push({
        author: flags.pharmaOffer ? f.sender : f.recipient,
        getFlag: (_ns, key) => flags[key],
        async delete() {
          f.game.messages.splice(f.game.messages.indexOf(this), 1);
        },
      });
    }
  }
  const gm = { id: "gm", isGM: true, active: true };
  f.game.users.forEach((u) => {
    u.active = false;
  });
  f.game.users.push(gm);
  f.game.user = gm;
  return { ...f, rows, write, sent, received, gm };
}

test("manual pharma cleanup retains 50 settled transfers per character and removes only their older cards", async () => {
  const f = await cleanupFixture();
  const oldOffer = f.game.messages[0];
  const unresolved = ["withdrawing", "offered", "returning"].map(
    (status, i) => ({ ...f.sent[0], id: "pending" + i, status }),
  );
  await f.write(f.source, [...f.sent, ...unresolved]);
  await f.write(f.target, [
    ...f.received,
    { ...f.received[0], id: "receiving", status: "receiving" },
  ]);
  const unrelated = { getFlag: () => undefined };
  f.game.messages.push(unrelated);
  await f.api.purgePharmaHistory(50);
  assert.equal(f.rows("source").length, 53);
  assert.equal(f.rows("target").length, 51);
  assert.equal(f.rows("source")[0].id, f.sent[2].id);
  assert.equal(f.rows("target")[0].id, f.sent[2].id);
  assert.equal(f.game.messages.length, 101);
  assert.ok(f.game.messages.includes(unrelated));
  assert.equal(f.source.items.find((i) => i.id === "drug").system.amount, 5);
  assert.equal(f.target.items.length, 0);
  f.game.user = f.recipient;
  await assert.rejects(f.api.respondToPharma(oldOffer), /no longer available/);
});

test("pharma cleanup waits for a sole GM and both sides to settle", async () => {
  const f = await cleanupFixture();
  f.recipient.active = true;
  await assert.rejects(f.api.purgePharmaHistory(50), /disconnect/);
  assert.equal(f.rows("source").length, 52);
  assert.equal(f.game.messages.length, 104);
  f.recipient.active = false;
  const received = f.received.map((t, n) =>
    n < 2 ? { ...t, status: "receiving" } : t,
  );
  await f.write(f.target, received);
  await f.api.purgePharmaHistory(50);
  assert.equal(f.rows("source").length, 52);
  assert.equal(f.rows("target").length, 52);
  assert.equal(f.rows("source").filter((t) => t.settled).length, 50);
  assert.equal(f.game.messages.length, 104);
});

test("failed pharma chat deletion retains receipts and cleanup can retry", async () => {
  const f = await cleanupFixture();
  const message = f.game.messages[1];
  const remove = message.delete;
  message.delete = async () => {
    throw Error("Deletion failed");
  };
  await assert.rejects(f.api.purgePharmaHistory(50), /Deletion failed/);
  assert.equal(f.rows("source").length, 52);
  assert.equal(f.rows("target").length, 52);
  message.delete = remove;
  await f.api.purgePharmaHistory(50);
  assert.equal(f.rows("source").length, 50);
  assert.equal(f.rows("target").length, 50);
  assert.equal(f.game.messages.length, 100);
});

test("pharma cleanup retries partial Journal pruning without needing the removed counterpart", async () => {
  const f = await cleanupFixture();
  const page = f
    .load("journal-records")
    .recordPage(
      f.load("journal-records").actorPayoutJournal("target"),
      "pharmaTransfers",
    );
  const update = page.update;
  page.update = async (changes) => {
    if (changes["flags.pneuma-crewtools.data"]?.length === 50)
      throw Error("Prune failed");
    return update.call(page, changes);
  };
  await assert.rejects(f.api.purgePharmaHistory(50), /Prune failed/);
  assert.equal(f.rows("source").length, 50);
  assert.equal(f.rows("target").length, 52);
  page.update = update;
  await f.api.purgePharmaHistory(50);
  assert.equal(f.rows("target").length, 50);
});

test("a user connecting during pharma maintenance stops pruning", async () => {
  const f = await cleanupFixture();
  const message = f.game.messages[0];
  const remove = message.delete;
  message.delete = async function () {
    await remove.call(this);
    f.recipient.active = true;
  };
  await assert.rejects(f.api.purgePharmaHistory(50), /another user connected/);
  assert.equal(f.rows("source").length, 52);
  assert.equal(f.rows("target").length, 52);
});

test("connection hooks never purge pharma history", async () => {
  const f = await cleanupFixture();
  f.api.registerPharmaTransfers();
  f.recipient.active = true;
  f.emit("userConnected");
  await f.load("action-coordinator").queueAction(async () => {});
  assert.equal(f.rows("source").length, 52);
  f.recipient.active = false;
  f.emit("userConnected");
  await f.load("action-coordinator").queueAction(async () => {});
  assert.equal(f.rows("source").length, 52);
  assert.equal(f.rows("target").length, 52);
  await f.api.purgePharmaHistory(10);
  assert.equal(f.rows("source").length, 10);
  assert.equal(f.rows("target").length, 10);
});

test("manual pharma retention applies only to the selected character, including keep zero", async () => {
  const f = await cleanupFixture();
  await f.api.purgePharmaHistory(50, "source");
  assert.equal(f.rows("source").length, 50);
  assert.equal(f.rows("target").length, 52);
  await f.api.purgePharmaHistory(0, "target");
  assert.equal(f.rows("source").length, 50);
  assert.equal(f.rows("target").length, 0);
  assert.equal(f.game.messages.length, 0);
  await f.api.purgePharmaHistory(0, "source");
  assert.equal(f.rows("source").length, 0);
});

test("Medtech panel refreshes reuse chat responses and invalidate on response changes", async () => {
  const f = fixture();
  await f.setup();
  f.api.registerPharmaTransfers();
  let reads = 0;
  f.game.messages = Array.from({ length: 1000 }, () => ({
    getFlag() {
      reads++;
    },
  }));
  const panel = new f.api.PharmaTransferPanel();
  for (let i = 0; i < 100; i++) panel.getData("source");
  assert.equal(reads, 1000);
  f.emit("updateChatMessage", f.game.messages[0]);
  panel.getData("source");
  assert.equal(reads, 2000);
});

test("recipient lists build exclusions a fixed number of times as the roster grows", async () => {
  const f = fixture();
  await f.setup();
  let reads = 0,
    excluded = [];
  f.game.settings.get = (_ns, key) => {
    if (key === "excludedActorIds") {
      reads++;
      return excluded;
    }
    return [];
  };
  const panel = new f.api.PharmaTransferPanel();
  panel.getData("source");
  const baseline = reads;
  for (let i = 0; i < 100; i++)
    f.game.actors.push({
      id: "extra" + i,
      name: "Extra" + i,
      type: "character",
      testUserPermission: (u) => u.id === f.recipient.id,
    });
  f.game.actors.push({
    id: "gmOnly",
    name: "GM",
    type: "character",
    testUserPermission: (u) => u.isGM,
  });
  reads = 0;
  excluded = ["target"];
  const data = panel.getData("source");
  assert.equal(reads, baseline);
  assert.equal(reads, 2);
  assert.equal(
    data.recipients.some((a) => ["source", "target", "gmOnly"].includes(a.id)),
    false,
  );
  assert.equal(
    data.recipients.filter((a) => a.id.startsWith("extra")).length,
    100,
  );
});

test("chat rendering reads fresh transfer status without copying Item payloads", async () => {
  const f = fixture();
  await f.setup();
  f.api.registerPharmaTransfers();
  f.game.user = f.recipient;
  const store = f.load("journal-records"),
    journal = store.actorPayoutJournal("target");
  await store.writeRecord(journal, "pharmaTransfers", "Transfers", [], "");
  const page = store.recordPage(journal, "pharmaTransfers");
  let payloadReads = 0;
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: "old" + i,
    status: "consumed",
    get item() {
      payloadReads++;
      return { large: "payload" };
    },
  }));
  const receipt = {
    id: "offer",
    status: "receiving",
    get item() {
      payloadReads++;
      return { large: "payload" };
    },
  };
  rows.push(receipt);
  page.flags["pneuma-crewtools"].data = rows;
  f.game.user = f.recipient;
  for (let i = 0; i < 100; i++) assert.equal(renderOffer(f), true);
  assert.equal(payloadReads, 0);
  page.flags["pneuma-crewtools"].data = [];
  assert.equal(renderOffer(f), false);
});
