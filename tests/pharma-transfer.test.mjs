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
  const globals = {
    game,
    ...journalWorld(game),
    FormApplication: class {},
    Hooks: { on() {}, once() {} },
    foundry: {
      utils: { randomID: () => String(++sequence).padStart(16, "a") },
    },
    ui: { notifications: { warn() {}, error() {}, info() {} } },
    ChatMessage: {
      async create(data) {
        const message = {
          ...structuredClone(data),
          author: game.user,
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
