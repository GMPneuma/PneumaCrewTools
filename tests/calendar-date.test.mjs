import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const api = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      new URL("../src/calendar-date.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: api, Date },
);

test("Gregorian boundaries include leap centuries and reject invalid input", () => {
  assert.equal(api.shiftDate("2048-02-28", 1), "2048-02-29");
  assert.equal(api.shiftDate("2048-02-29", 1), "2048-03-01");
  assert.equal(api.shiftDate("2100-02-28", 1), "2100-03-01");
  assert.equal(api.shiftDate("2000-02-28", 1), "2000-02-29");
  assert.equal(api.shiftDate("2045-12-31", 1), "2046-01-01");
  assert.equal(api.shiftDate("2045-01-01", -1), "2044-12-31");
  assert.equal(api.shiftDate("0099-12-31", 1), "0100-01-01");
  for (const invalid of [
    "2045-02-29",
    "2045-04-31",
    "2045-13-01",
    "0000-01-01",
    "45-01-01",
    "2045-1-1",
    "hello",
  ])
    assert.throws(() => api.parseDate(invalid));
  assert.throws(() => api.shiftDate("9999-12-31", 1));
  assert.throws(() => api.shiftDate("2045-01-01", 0.5));
});
test("shim crosses midnight independently of local timezone and handles negative time", () => {
  assert.equal(api.shimDate(Date.UTC(2045, 0, 1) / 1000 + 90000), "2045-01-02");
  assert.equal(api.shimDate(Date.UTC(2045, 0, 1) / 1000 + 81000), "2045-01-01");
  assert.equal(api.shimDate(Date.UTC(2045, 0, 1) / 1000 - 1), "2044-12-31");
});
test("native adapter respects epoch and zero-based month/day components", () => {
  const calls = [];
  const native = {
    years: { yearZero: 2000 },
    componentsToTime(parts) {
      calls.push(parts);
      return 123;
    },
    timeToComponents(time) {
      assert.equal(time, 123);
      return { year: 48, month: 1, dayOfMonth: 28 };
    },
  };
  assert.equal(api.nativeDate(native, 123), "2048-02-29");
  assert.equal(api.nativeTime(native, "2048-02-29"), 123);
  assert.equal(calls[0].year, 48);
  assert.equal(calls[0].day, 59);
  native.timeToComponents = () => ({ year: 48, month: 2, dayOfMonth: 0 });
  assert.throws(() => api.nativeTime(native, "2048-02-29"), /does not match/);
});
