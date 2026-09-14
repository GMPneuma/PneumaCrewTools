import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
test("refresh batches asynchronous bursts and cannot be postponed beyond 250ms", () => {
  const exports = {},
    timers = new Map();
  let now = 0,
    id = 0,
    count = 0;
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/ui-refresh.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require: () => ({ MODULE_ID: "crew" }),
      Date: { now: () => now },
      setTimeout: (fn, delay) => {
        timers.set(++id, { fn, at: now + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const refresh = exports.coalesceRefresh(() => count++);
  refresh();
  now = 50;
  refresh();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].at, 125);
  now = 110;
  refresh();
  now = 170;
  refresh();
  now = 230;
  refresh();
  assert.equal([...timers.values()][0].at, 250);
  now = 250;
  [...timers.values()][0].fn();
  timers.clear();
  assert.equal(count, 1);
  now = 300;
  refresh();
  assert.equal([...timers.values()][0].at, 375);
});
