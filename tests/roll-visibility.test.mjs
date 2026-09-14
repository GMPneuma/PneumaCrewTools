import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("activity rolls default public; private rolls include owners and GMs only", () => {
  let setting;
  const exports = {};
  const users = [{ id: "gm", isGM: true }, { id: "owner" }, { id: "other" }];
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/roll-visibility.ts", import.meta.url),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: () => ({ MODULE_ID: "pneuma-crewtools" }),
      game: { settings: { get: () => setting }, users },
    },
  );
  const actor = { testUserPermission: (user) => user.id === "owner" };
  assert.deepEqual(Array.from(exports.activityRollRecipients(actor)), []);
  setting = false;
  assert.deepEqual(Array.from(exports.activityRollRecipients(actor)), []);
  setting = true;
  assert.deepEqual(Array.from(exports.activityRollRecipients(actor)), [
    "gm",
    "owner",
  ]);
  assert.deepEqual(
    Array.from(exports.activityRollRecipients(undefined, "owner")),
    ["gm", "owner"],
  );
});
