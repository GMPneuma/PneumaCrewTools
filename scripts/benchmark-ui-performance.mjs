// Synthetic CPU benchmarks; these do not measure live Foundry rendering or network writes.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { performance } from "node:perf_hooks";
function loader(globals = {}) {
  const cache = new Map();
  const load = (name) => {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(`src/${name}.ts`, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        require: (key) => load(key.slice(2)),
        structuredClone,
        console,
        ...globals,
      },
    );
    return exports;
  };
  return load;
}
function median(fn, count = 5) {
  fn();
  const times = [];
  for (let n = 0; n < count; n++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return +times.sort((a, b) => a - b)[Math.floor(count / 2)].toFixed(2);
}
const model = loader()("downtime-model");
for (const cycles of [125, 625, 1250]) {
  const events = [
    {
      id: "award",
      actorId: "a",
      kind: "award",
      days: cycles * 7,
      period: 1,
      date: "2045-01-01",
      reason: "award",
      payoutId: "p",
    },
  ];
  for (let n = 0; n < cycles; n++) {
    for (let d = 0; d < 7; d++)
      events.push({
        id: `d${n}-${d}`,
        actorId: "a",
        kind: "nomadRespecDay",
        days: 1,
        period: 1,
        date: "2045-01-01",
        reason: "day",
      });
    events.push({
      id: `r${n}`,
      actorId: "a",
      kind: "nomadRespecReset",
      days: 0,
      period: 1,
      date: "2045-01-01",
      reason: "reset",
    });
  }
  const state = {
    version: 1,
    period: 1,
    accounts: [{ actorId: "a", name: "A", characterJournalId: "j" }],
    events,
  };
  console.log(
    JSON.stringify({
      test: "respec-ledger-validation",
      events: events.length,
      medianMs: median(() => model.validateDowntime(state)),
    }),
  );
}
for (const [actorCount, journalCount] of [
  [100, 20],
  [500, 50],
  [1000, 50],
]) {
  let iterations = 0;
  const actors = Array.from({ length: actorCount }, (_, n) => ({
    id: `a${n}`,
    type: "character",
    name: `A${n}`,
    testUserPermission: () => true,
  }));
  actors[Symbol.iterator] = function* () {
    for (let i = 0; i < this.length; i++) {
      iterations++;
      yield this[i];
    }
  };
  const journals = Array.from({ length: journalCount }, (_, n) => ({
    getFlag: (_ns, key) =>
      key === "recordKind"
        ? "character"
        : key === "actorId"
          ? `a${n}`
          : undefined,
    pages: [
      {
        getFlag: (_ns, key) =>
          key === "recordKey" ? "teammates" : { slots: [null, null, null] },
      },
    ],
  }));
  const game = {
    actors,
    journal: journals,
    users: [],
    user: { isGM: false },
    settings: { get: () => [] },
  };
  const policy = loader({ game })("actor-policy");
  const medianMs = median(() => policy.accessibleCrewActors(), 3);
  iterations = 0;
  policy.accessibleCrewActors();
  console.log(
    JSON.stringify({
      test: "crew-selector",
      actors: actorCount,
      journals: journalCount,
      actorIterations: iterations,
      medianMs,
    }),
  );
}
