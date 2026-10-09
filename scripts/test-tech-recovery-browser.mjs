import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import Handlebars from "handlebars";
const { chromium } = await import(
  process.env.PNEUMA_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 850, height: 900 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(
    "<style>" +
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8") +
      "</style><main></main>",
  );
  const render = Handlebars.compile(
    fs.readFileSync("static/templates/downtime.hbs", "utf8"),
  );
  await page.locator("main").evaluate(
    (el, html) => {
      el.innerHTML = html;
    },
    render({
      isGM: true,
      hasTechBlocker: true,
      hasActor: true,
      actorId: "tech",
      balance: 8,
    }),
  );
  assert.equal(await page.locator("[data-tech-recovery]").count(), 1);
  await page.evaluate(() => {
    window.actor = { id: "tech", name: "Tech" };
    window.game = {
      user: { id: "gm", name: "GM", isGM: true },
      actors: new Map([["tech", actor]]),
    };
    window.flags = {
      techAttempt: {
        requestId: "attempt-1",
        action: "Mark project Item",
        sourceUuid: "Actor.tech.Item.original",
        destinationActorId: "storage",
        destinationItemId: "reference",
        remainderActorId: "tech",
        remainderItemId: "remainder",
      },
    };
    window.notices = [];
    window.ui = {
      notifications: {
        warn: (m) => notices.push(m),
        info: (m) => notices.push(m),
        error: (m) => notices.push(m),
      },
    };
    window.ledger = {
      id: "ledger",
      getFlag: (_ns, key) => flags[key],
      parent: {
        sheet: {
          render() {
            window.journalOpened = true;
          },
        },
      },
      async update(data) {
        for (const [key, value] of Object.entries(data))
          if (key.startsWith("flags."))
            flags[key.split(".").at(-1)] = structuredClone(value);
      },
    };
    window.actorLedger = () => ledger;
    window.getDowntime = () => ({
      accounts: [{ actorId: "tech" }],
      events: [],
    });
    window.ledgerHtml = () => "<p>Recovery recorded</p>";
    window.MODULE_ID = "pneuma-crewtools";
    window.withGMAction = (fn) => fn();
    window.withResourceLock = (fn) => fn();
    window.escape = (v) =>
      String(v).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    window.Dialog = class {
      constructor(config) {
        this.config = config;
      }
      render() {
        const el = document.createElement("section");
        el.className = "window-app pneuma-crewtools";
        el.style.cssText = "width:600px;position:absolute;top:80px;left:60px;";
        el.innerHTML =
          '<header class="window-header">' +
          this.config.title +
          '</header><div class="window-content"><form>' +
          this.config.content +
          '<footer class="dialog-buttons"></footer></form></div>';
        document.body.appendChild(el);
        this.element = [el];
        for (const [key, button] of Object.entries(this.config.buttons)) {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.action = key;
          b.textContent = button.label;
          b.onclick = () => this.submit(button);
          el.querySelector("footer").appendChild(b);
        }
        return this;
      }
      async submit(button) {
        await button.callback?.(this.element);
        await this.close();
      }
      async close() {
        this.element[0].remove();
        this.config.close?.();
      }
    };
  });
  const js = ts
    .transpileModule(fs.readFileSync("src/tech-recovery.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/^import .*;\s*/gm, "")
    .replace(/^export /gm, "");
  await page.addScriptTag({
    content:
      js +
      '\ndocument.querySelector("[data-tech-recovery]").addEventListener("click",()=>reviewInterruptedTechAttempt("tech"));',
  });
  await page.locator("[data-tech-recovery]").click();
  assert.equal(
    await page.locator(".crewtools-tech-recovery a[data-uuid]").count(),
    3,
  );
  await page.locator('[data-action="clear"]').click();
  assert.equal(
    await page.locator(".crewtools-tech-recovery").count(),
    1,
    "unconfirmed review stays open",
  );
  assert.equal(
    await page.evaluate(() => flags.techAttempt.requestId),
    "attempt-1",
  );
  await page.locator("[data-tech-recovery-confirm]").check();
  await page.locator('[data-action="clear"]').click();
  assert.equal(
    await page.locator(".crewtools-tech-recovery").count(),
    1,
    "missing note stays open",
  );
  await page
    .locator("[data-tech-recovery-note]")
    .fill("Reviewed Item and project; corrected partial changes.");
  await page.locator('[data-action="clear"]').click();
  assert.equal(await page.locator(".crewtools-tech-recovery").count(), 0);
  assert.equal(await page.evaluate(() => flags.techAttempt), null);
  assert.equal(
    await page.evaluate(() => flags.techRecoveries[0].attempt.requestId),
    "attempt-1",
  );
  await page.locator("main").evaluate(
    (el, html) => {
      el.innerHTML = html;
    },
    render({ isGM: false, hasTechBlocker: true }),
  );
  assert.equal(
    await page.locator("[data-tech-recovery]").count(),
    0,
    "player never sees the clear button",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS GM-only Downtime control, linked items, confirmation/note validation, retained audit and player exclusion.",
  );
} finally {
  await browser.close();
}
