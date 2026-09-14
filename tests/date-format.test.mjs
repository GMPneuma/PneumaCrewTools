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
  assert.equal(api.displayDate("2078-02-06"), "02-06-2078");
  assert.equal(api.displayDate("2024-02-29T00:15:00Z"), "02-29-2024T00:15:00Z");
  assert.equal(api.storageDate("02-06-2078"), "2078-02-06");
  assert.equal(api.storageDate("2078-02-06"), "2078-02-06");
  assert.equal(api.displayDate(""), "");
});
