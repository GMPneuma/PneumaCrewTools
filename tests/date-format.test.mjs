import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const api = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(new URL("../src/date-format.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: api },
);
test("display dates preserve calendar days and timestamps without timezone shifts", () => {
  assert.equal(api.displayDate("2078-02-06"), "2-6-2078");
  assert.equal(api.displayDate("2024-02-29T00:15:00Z"), "2-29-2024T00:15:00Z");
  assert.equal(api.storageDate("2-6-2078"), "2078-02-06");
  assert.equal(api.storageDate("2078-02-06"), "2078-02-06");
  assert.equal(api.displayDate(""), "");
});

test("month display omits zeros and accepts both old and new inputs", () => {
  for (let month = 1; month <= 12; month++) {
    const iso = `2078-${String(month).padStart(2, "0")}-06`;
    assert.equal(api.displayDate(iso), `${month}-6-2078`);
    assert.equal(api.storageDate(api.displayDate(iso)), iso);
  }
  assert.equal(api.storageDate("02-06-2078"), "2078-02-06");
  assert.equal(api.displayDate("02-06-2078"), "2-6-2078");
});

test("day display omits zeros and round trips padded and unpadded dates", () => {
  for (let day = 1; day <= 31; day++) {
    const iso = `2078-01-${String(day).padStart(2, "0")}`;
    assert.equal(api.displayDate(iso), `1-${day}-2078`);
    assert.equal(api.storageDate(api.displayDate(iso)), iso);
  }
  for (const text of ["02-06-2078", "2-06-2078", "02-6-2078", "2-6-2078"]) {
    assert.equal(api.displayDate(text), "2-6-2078");
    assert.equal(api.storageDate(text), "2078-02-06");
  }
});
