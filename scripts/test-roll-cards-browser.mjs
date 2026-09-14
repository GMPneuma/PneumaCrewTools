import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
function load(name) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/" + name + ".ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { exports, require: (p) => load(p.slice(2)) },
  );
  return exports;
}
const { rollCard } = load("roll-card");
const cards = [
  {
    title: "TECH Project",
    actor: "Peetee",
    subject: "Heavy Armorjack (Head)",
    outcome: "FAILURE",
    success: false,
    check: { total: 8, dv: 21, label: "Basic Tech + Fabrication Expertise 0" },
    effect: "3 days burned. Add days before retrying.",
  },
  {
    title: "Hustle — Netrunner",
    actor: "Peetee",
    subject: "Rank 8 · 7 downtime days",
    outcome: "PAID",
    success: true,
    detail: "Cracked a major Corporate system and sold the data.",
    effect: "+600 eb paid",
  },
  {
    title: "Medtech — Pharmaceuticals",
    actor: "Peetee",
    subject: "Speedheal",
    outcome: "SUCCESS",
    success: true,
    check: { total: 19, dv: 13, label: "Medical Tech Skill" },
    detail: "1 hour used · Workday 6 / 16 hours",
    effect: "3 doses added to inventory.",
  },
];
assert.ok(
  rollCard({ ...cards[0], subject: "<img src=x onerror=alert(1)>" }).includes(
    "&lt;img",
  ),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 950 } });
  const css = fs.readFileSync(
    new URL("../src/styles/pneuma-crewtools.css", import.meta.url),
    "utf8",
  );
  // Mock Foundry's surrounding chat and CPR frame; card content/CSS are the real module output.
  await page.setContent(
    `<style>${css}body{font:16px Arial;margin:10px;background:#555;display:flex;gap:12px}.column{width:440px}.message{padding:9px;margin-bottom:10px;border:2px solid #777;border-radius:6px;background:#eee;color:#151515}.theme-dark .message{background:#24282b;color:#eee}.cpr-block{border:3px solid #b52222}*{box-sizing:border-box}</style>` +
      ["light", "theme-dark"]
        .map(
          (theme) =>
            `<div class="column ${theme}">${cards.map((c) => `<div class="message">${rollCard(c)}</div>`).join("")}</div>`,
        )
        .join(""),
  );
  for (const width of [440, 300]) {
    await page
      .locator(".column")
      .evaluateAll(
        (els, w) => els.forEach((el) => (el.style.width = w + "px")),
        width,
      );
    assert.ok(
      await page
        .locator(".message")
        .evaluateAll((els) =>
          els.every((el) => el.scrollWidth <= el.clientWidth),
        ),
    );
  }
  await page
    .locator(".column")
    .evaluateAll((els) => els.forEach((el) => (el.style.width = "440px")));
  if (process.env.ROLL_CARD_SCREENSHOT)
    await page.screenshot({ path: process.env.ROLL_CARD_SCREENSHOT });
  console.log(
    "PASS roll cards escape content and fit narrow chat columns in light and dark previews.",
  );
} finally {
  await browser.close();
}
