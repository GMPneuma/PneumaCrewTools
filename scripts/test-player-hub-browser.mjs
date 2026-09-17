import fs from "node:fs";
import { createRequire } from "node:module";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const template = Handlebars.compile(
  fs.readFileSync(
    new URL("../static/templates/payout-inbox.hbs", import.meta.url),
    "utf8",
  ),
);
const css = fs.readFileSync(
  new URL("../src/styles/pneuma-crewtools.css", import.meta.url),
  "utf8",
);
const data = {
  isGM: false,
  hasItems: true,
  status: {
    actorId: "a1",
    hasActor: true,
    actors: [{ id: "a1", name: "V", selected: true }],
    actorName: "V",
    downtime: "4",
    money: "2,450",
    ip: "65",
    reputation: "3",
  },
  cards: [
    {
      id: "a1",
      sessionLabel: "The Pickup",
      inGameDate: "Feb 6, 2078",
      actorName: "V",
      statusClass: "inbox-card--ready",
      statusLabel: "Ready to acknowledge",
      expanded: true,
      acknowledgmentId: "a1",
      userId: "p1",
      awards: [
        {
          label: "Money",
          text: "Money",
          value: "1,000 eb",
          description: "Gig payment",
          icon: "fas fa-coins",
        },
        {
          label: "IP",
          text: "IP",
          value: "50",
          description: "Session award",
          icon: "fas fa-star",
        },
        {
          label: "Downtime",
          text: "Downtime",
          value: "4 days",
          description: "Time between gigs",
          icon: "fas fa-hourglass-half",
        },
      ],
    },
  ],
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 850 },
  });
  await page.setContent(
    "<style>body{font:14px Arial;background:#373b3e} .window-app{width:650px;margin:20px;background:#ddd;color:#222;border:1px solid #777;border-radius:4px}header{padding:8px;background:#272727;color:white}button,input,select{font:inherit}button{padding:5px;border:1px solid #999;border-radius:3px;background:#eee;color:inherit}button:disabled{opacity:.5}fieldset{min-width:0}h2{font-size:18px}" +
      css +
      '</style><div class="window-app pneuma-crewtools"><header>Crew Tools Player Hub</header><div class="window-content">' +
      template(data) +
      "</div></div>",
  );
  await page
    .locator("[data-inbox-expanded]")
    .evaluateAll((nodes) =>
      nodes.forEach((n) => (n.open = n.dataset.inboxExpanded === "true")),
    );
  assert.equal(await page.locator(".hub-metrics dd").count(), 4);
  assert.deepEqual(
    await page
      .locator(".hub-actions button")
      .allTextContents()
      .then((labels) => labels.map((s) => s.trim().replace(/\s+/g, " "))),
    ["Spend Downtime", "Rent & Lifestyle", "View HQ", "Faction Reputation"],
  );
  const alignment = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll(".hub-metrics > div"));
    const buttons = Array.from(
      document.querySelectorAll(".hub-actions button"),
    );
    return tiles.map((tile, i) => {
      const t = tile.getBoundingClientRect(),
        b = buttons[i].getBoundingClientRect();
      return (
        Math.abs(t.left - b.left) < 1 &&
        Math.abs(t.width - b.width) < 1 &&
        b.top >= t.bottom
      );
    });
  });
  assert.ok(
    alignment.every(Boolean),
    "each action matches its metric tile width and column",
  );

  assert.equal(
    await page.getByRole("button", { name: /Rent & Lifestyle/ }).isDisabled(),
    false,
  );
  assert.equal(
    await page.getByRole("button", { name: "Spend Downtime" }).isEnabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Acknowledge", exact: true })
      .count(),
    1,
  );
  const bounds = await page.evaluate(() => ({
    status: document.querySelector(".hub-status").getBoundingClientRect()
      .height,
    payout: document.querySelector(".inbox-card").getBoundingClientRect()
      .height,
    overflow:
      document.querySelector(".payout-inbox-form").scrollWidth >
      document.querySelector(".payout-inbox-form").clientWidth,
  }));
  assert.equal(bounds.overflow, false);
  assert.ok(
    bounds.status < bounds.payout,
    "dashboard stays smaller than an expanded payout",
  );
  if (process.env.HUB_SCREENSHOT)
    await page
      .locator(".window-app")
      .screenshot({ path: process.env.HUB_SCREENSHOT });
  // A long GM inbox must scroll, not collapse the opt-in controls to their borders.
  await page.locator(".window-content").evaluate(
    (el, html) => (el.innerHTML = html),
    template({
      ...data,
      isGM: true,
      hasAcknowledgments: true,
      hasPendingRolls: true,
      cards: Array.from({ length: 30 }, (_, i) => ({
        ...data.cards[0],
        id: "card" + i,
      })),
    }),
  );
  await page
    .locator("[data-inbox-expanded]")
    .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
  const gmLayout = await page.locator(".inbox-gm-panel").evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
    checkbox: el.querySelector("input").getBoundingClientRect().height,
  }));
  assert.ok(
    gmLayout.height >= gmLayout.content - 1,
    "GM controls retain their full content height in a long inbox",
  );
  assert.ok(gmLayout.checkbox > 0);
  await page
    .locator(".payout-inbox-form")
    .evaluate((el) => (el.scrollTop = 300));
  await page.locator("[data-enable-gm-actions]").check();
  assert.equal(
    await page.locator("[data-enable-gm-actions]").isChecked(),
    true,
  );
  console.log(
    "PASS long GM inbox retains visible, clickable acknowledgment controls.",
  );
  const activityTemplate = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/downtime.hbs", import.meta.url),
      "utf8",
    ),
  );
  const activityHtml = activityTemplate({
    canStartPatient: true,
    patientChoices: [
      { id: "standard", label: "Standard · 500 eb", selected: true },
      { id: "extreme", label: "Extreme · 1000 eb" },
    ],
    ready: true,
    period: 1,
    canCraft: true,
    hasRoleAreas: true,
    canHustle: true,
    hustleDays: 8,
    hustleProgress: 100,
    canRollHustle: true,
    canAddHustle: true,
    multipleRoles: true,
    healingFormula: "(BODY 5 + 2 antibiotic) = 7 HP/day",
    hasActor: true,
    balance: 4,
    canHeal: true,
    medbayAvailable: false,
    healingOptions: { medbay: false, antibiotic: true, cryotank: false },
    healing: {
      restored: 7,
      rate: 7,
      body: 5,
      before: 10,
      after: 17,
      maximum: 40,
    },
    actorId: "a1",
    hasMultipleActors: false,
    actors: [{ id: "a1", name: "V", selected: true }],
    activities: [{ id: "spend", label: "Free-form activity" }],
    roles: [
      { id: "tech-role", name: "Tech", rank: 4 },
      { id: "fixer-role", name: "Fixer", rank: 2 },
    ],
    techSlots: [
      {
        slot: 0,
        number: 1,
        enabled: true,
        canAdd: true,
        canRoll: false,
        progressPercent: (100 * 2) / 7,
        project: {
          id: "project-1",
          name: "Smartgun upgrade",
          mode: "upgrade",
          progress: 2,
          required: 7,
          dv: 21,
        },
      },
      { slot: 1, number: 2, enabled: false, requiredWorkshop: "Workshop I" },
      { slot: 2, number: 3, enabled: false, requiredWorkshop: "Workshop II" },
    ],
    projects: [
      {
        id: "project-1",
        name: "Smartgun upgrade",
        kind: "crafting",
        days: 2,
        canAdd: true,
      },
      {
        id: "project-2",
        name: "Armor repair",
        kind: "crafting",
        days: 1,
        canAdd: true,
      },
    ],
  });
  await page.locator(".window-app").evaluate((el) => {
    el.style.width = "640px";
    el.style.height = "640px";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.id = "pneuma-crewtools-downtime";
  });
  await page.locator(".window-content").evaluate((el) => {
    el.style.flex = "1";
    el.style.minHeight = "0";
  });
  await page
    .locator("header")
    .evaluate((el) => (el.textContent = "Crew Tools — Downtime"));
  await page
    .locator(".window-content")
    .evaluate((el, html) => (el.innerHTML = html), activityHtml);
  assert.equal(await page.locator(".downtime-heal [data-heal-day]").count(), 1);
  assert.equal(await page.locator("[data-heal-day]").isEnabled(), true);
  assert.equal(
    await page.locator('[data-healing-option="medbay"]').isDisabled(),
    true,
  );
  assert.equal(
    await page.locator('[data-healing-option="antibiotic"]').isChecked(),
    true,
  );
  assert.match(
    await page.locator(".downtime-heal-summary").innerText(),
    /7 HP/,
  );
  assert.equal(await page.locator("[data-tech-slot]").count(), 3);
  assert.equal(await page.locator('[data-tech-action="techDay"]').count(), 1);
  assert.equal(
    await page.locator(".tech-slot").getByText("Requires Workshop").count(),
    2,
  );
  const header = await page.locator(".downtime-header").boundingBox();
  assert.ok(header.height < 60);
  assert.equal(await page.locator('select[name="actorId"]').count(), 0);
  assert.equal(await page.locator('input[name="actorId"]').inputValue(), "a1");
  assert.equal(
    await page.locator(".downtime-tech [data-tech-mode]").count(),
    0,
  );
  assert.equal(
    await page.locator('[name="hustleRoleItemId"] option').count(),
    2,
  );
  assert.equal(await page.locator('[name="kind"]').count(), 0);
  assert.equal(
    await page
      .locator(".payout-inbox-form")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  assert.equal(await page.locator('[name="patientType"] option').count(), 2);
  assert.equal(await page.locator('[name="patientPC"]').count(), 1);
  assert.equal(await page.locator('[name="patientAddiction"]').count(), 0);
  assert.equal(await page.locator("[data-hustle-roll]").isEnabled(), true);
  assert.equal(await page.locator("[data-hustle-day]").isEnabled(), true);
  assert.equal(
    await page.getByText("Requires an HQ with a Medbay improvement.").count(),
    0,
  );
  const healBoxes = await page.evaluate(() => {
    const left = document
      .querySelector(".downtime-heal-main")
      .getBoundingClientRect();
    const right = document
      .querySelector(".downtime-heal-options")
      .getBoundingClientRect();
    return {
      leftRight: left.right,
      rightLeft: right.left,
      leftTop: left.top,
      leftBottom: left.bottom,
      rightTop: right.top,
    };
  });
  assert.ok(healBoxes.leftRight < healBoxes.rightLeft);
  assert.ok(
    healBoxes.rightTop >= healBoxes.leftTop - 20 &&
      healBoxes.rightTop < healBoxes.leftBottom,
  );
  if (process.env.DOWNTIME_SCREENSHOT)
    await page
      .locator(".window-app")
      .screenshot({ path: process.env.DOWNTIME_SCREENSHOT });
  console.log(
    "PASS activity template, project mini-lists and multiclass role picker.",
  );
  assert.equal(
    await page.locator(".downtime-hustle-row progress").getAttribute("value"),
    "100",
  );
  assert.equal(await page.locator(".tech-slot-title progress").count(), 1);
  await page.locator(".window-content").evaluate(
    (el, html) => (el.innerHTML = html),
    activityTemplate({
      ready: true,
      hasActor: true,
      actorId: "a1",
      balance: 7,
      canCraft: false,
      hasRoleAreas: true,
      hustleDays: 2,
      hustleProgress: 200 / 7,
    }),
  );
  assert.equal(
    await page.locator('[data-downtime-section="tech"] > summary').innerText(),
    "Repair Gear",
  );
  assert.equal(await page.locator("[data-tech-mode]").count(), 0);

  assert.equal(
    await page.locator('[data-medical-action="patientStart"]').count(),
    1,
  );
  assert.equal(await page.locator(".downtime-medical").count(), 0);
  await page.locator(".window-content").evaluate(
    (el, html) => (el.innerHTML = html),
    activityTemplate({
      ready: true,
      hasActor: true,
      actorId: "doctor",
      balance: 5,
      canMedtech: true,
      hasRoleAreas: true,
      canCraft: false,
      medicalRank: 3,
      surgeryRank: 4,
      medicalHours: 6,
      medicalRemaining: 10,
      medicalReserved: true,
      canFinishMedicalDay: false,
      patient: {
        name: "Standard Humanity Loss",
        days: 3,
        progress: 300 / 7,
        pc: true,
        formula: "2d6",
        canAdd: true,
        canFinish: false,
      },
      provider: {
        name: "Extreme Humanity Loss",
        targetName: "Peetee",
        days: 4,
        progress: 400 / 7,
        canAdd: true,
        canFinish: false,
      },
      injuries: [
        { uuid: "Item.broken-arm", name: "Broken Arm", dv: 13 },
        { uuid: "Item.spinal-injury", name: "Spinal Injury", dv: 17 },
      ],
      pharma: [{ uuid: "Item.speedheal", name: "Speedheal" }],
      medicalTasks: [
        {
          id: "s1",
          name: "Broken Arm",
          hours: 4,
          dv: 13,
          attempts: 1,
          status: "Needs check",
          success: false,
          canRoll: true,
        },
        {
          id: "p1",
          name: "Speedheal",
          hours: 1,
          dv: 13,
          attempts: 2,
          status: "Successful",
          success: true,
          doses: 3,
        },
      ],
      hustleDays: 2,
      hustleProgress: 200 / 7,
      canHustle: true,
      canAddHustle: true,
      roles: [{ id: "med", name: "Medtech", rank: 4 }],
      activities: [{ id: "spend", label: "Free-form activity" }],
      healing: { restored: 5, rate: 5, before: 10, after: 15, maximum: 40 },
      healingFormula: "BODY 5 = 5 HP/day",
      canHeal: true,
    }),
  );
  assert.equal(await page.locator(".downtime-medical").count(), 2);
  const commonBounds = await page.locator(".downtime-common").boundingBox();
  const roleBounds = await page.locator(".downtime-roles").boundingBox();
  assert.ok(roleBounds.y >= commonBounds.y + commonBounds.height);
  assert.ok(Math.abs(roleBounds.x - commonBounds.x) < 2);
  assert.ok(Math.abs(roleBounds.width - commonBounds.width) < 2);
  assert.equal(
    await page.locator(".downtime-common .downtime-medical").count(),
    0,
  );
  assert.equal(
    await page.locator(".downtime-roles .downtime-medical").count(),
    2,
  );
  await page
    .locator(".window-app")
    .evaluate((el) => (el.style.height = "360px"));
  const scroll = await page.locator(".downtime-stack").evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight,
    overflow: getComputedStyle(el).overflowY,
    horizontal: el.scrollWidth > el.clientWidth,
  }));
  assert.equal(scroll.scrolls, true);
  assert.equal(scroll.overflow, "auto");
  assert.equal(scroll.horizontal, false);
  await page
    .locator(".window-app")
    .evaluate((el) => (el.style.height = "640px"));

  assert.equal(await page.locator('[name="surgeryItem"] option').count(), 2);
  await page
    .locator(".downtime-roles details")
    .evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
  const setup = await page.locator(".medical-workday-setup").boundingBox();
  const actions = await page.locator(".medical-workday-actions").boundingBox();
  assert.ok(actions.x >= setup.x + setup.width);
  assert.equal(await page.locator(".medical-task .medical-success").count(), 1);
  assert.equal(await page.locator(".medical-task .medical-failure").count(), 1);
  assert.equal(
    await page
      .locator('.medical-workday-actions [data-medical-action="taskRoll"]')
      .count(),
    1,
  );
  assert.equal(
    (
      await page.locator('[data-medical-action="finishDay"]').innerText()
    ).trim(),
    "Spend 1 Downtime Day",
  );
  assert.equal(
    await page.locator('[data-medical-action="taskRoll"]').count(),
    1,
  );
  assert.equal(
    await page.locator('[data-medical-action="finishDay"]').isDisabled(),
    true,
  );
  assert.equal(
    await page
      .locator(".medical-task")
      .getByText(/3\s+doses added/)
      .count(),
    1,
  );
  assert.equal(
    await page.locator('[data-downtime-section="tech"] > summary').innerText(),
    "Repair Gear",
  );
  assert.equal(await page.locator("[data-tech-mode]").count(), 0);
  assert.equal(
    await page
      .locator(".payout-inbox-form")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  if (process.env.MEDTECH_SCREENSHOT) {
    await page
      .locator('[data-medical-action="finishDay"]')
      .scrollIntoViewIfNeeded();
    await page
      .locator(".window-app")
      .screenshot({ path: process.env.MEDTECH_SCREENSHOT });
  }
  console.log(
    "PASS patient/Medtech therapy bars, medical task list and compact layout.",
  );
  await page.locator(".window-content").evaluate(
    (el, html) => (el.innerHTML = html),
    activityTemplate({
      ready: true,
      hasActor: true,
      fullWeek: true,
      balance: 0,
      hasRoleAreas: true,
      canMedtech: true,
      canRollHustle: false,
      patient: {
        name: "Standard Humanity Loss",
        days: 7,
        formula: "2d6",
        canFinish: true,
      },
      provider: {
        name: "Standard Humanity Loss",
        days: 7,
        targetName: "Patient",
        canFinish: true,
      },
    }),
  );
  assert.equal(await page.locator("[data-hustle-day]").count(), 0);
  assert.equal(
    await page
      .locator(
        '[data-medical-action="patientDay"],[data-medical-action="providerDay"]',
      )
      .count(),
    0,
  );
  assert.equal(await page.locator("[data-hustle-roll]").isDisabled(), true);
  assert.equal(
    await page.locator('[data-medical-action="patientComplete"]').isEnabled(),
    true,
  );
  assert.equal(
    await page.locator('[data-medical-action="providerComplete"]').isEnabled(),
    true,
  );
  console.log(
    "PASS full-week mode hides allocation controls and retains therapy result rolls.",
  );
  const hqTemplate = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/headquarters.hbs", import.meta.url),
      "utf8",
    ),
  );
  await page.locator(".window-app").evaluate((el) => {
    el.style.width = "640px";
    el.id = "pneuma-crewtools-headquarters";
  });
  await page
    .locator("header")
    .evaluate((el) => (el.textContent = "Crew Tools — Headquarters"));
  await page.locator(".window-content").evaluate(
    (el, html) => (el.innerHTML = html),
    hqTemplate({
      canManage: false,
      ip: 12,
      hasHq: true,
      headquarters: [
        { id: "hq1", name: "Warehouse", selected: true },
        { id: "hq2", name: "Safehouse" },
      ],
      hasContainer: true,
      containerName: "Warehouse Storage",
      hq: {
        name: "Warehouse",
        improvements: [
          { name: "Workshop", cost: 10, notes: "Tools and workbenches." },
          { name: "Security", cost: 5, notes: "Reinforced access." },
        ],
      },
    }),
  );
  assert.equal(await page.locator("[data-select-hq] option").count(), 2);
  assert.equal(await page.locator(".hq-installed tbody tr").count(), 2);
  assert.equal(await page.locator("[data-open-container]").isEnabled(), true);
  assert.equal(await page.locator("[data-buy-improvement]").count(), 0);
  assert.equal(
    await page
      .locator(".payout-inbox-form")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  if (process.env.HQ_SCREENSHOT)
    await page
      .locator(".window-app")
      .screenshot({ path: process.env.HQ_SCREENSHOT });
  console.log(
    "PASS multi-HQ viewer template, current improvements, and player read-only actions.",
  );
  console.log(
    "PASS actual hub template layout, payout emphasis, and action availability (mock base Foundry styles).",
  );

  await page.locator(".window-app").evaluate((el) => {
    el.id = "pneuma-crewtools-gm-dashboard";
    el.style.width = "650px";
    el.style.height = "680px";
  });
  await page
    .locator(".window-content")
    .evaluate(
      (el, html) => (el.innerHTML = html),
      template({ ...data, isGM: true, gmDashboard: true }),
    );
  assert.deepEqual(
    await page
      .locator("[data-gm-dashboard-action]")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.gmDashboardAction)),
    [
      "payout",
      "exportPayout",
      "calendar",
      "rent",
      "playerHub",
      "expire",
      "downtime",
      "adjustDowntime",
      "hqIp",
      "headquarters",
    ],
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Mark Rent Due", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(await page.locator(".hub-metrics").count(), 0);
  const actionsTop = await page
    .locator(".gm-dashboard-panel")
    .last()
    .boundingBox();
  const outstanding = await page.locator(".hub-payout-heading").boundingBox();
  assert.ok(outstanding.y >= actionsTop.y + actionsTop.height);
  assert.equal(await page.locator("[data-enable-gm-actions]").count(), 1);
  assert.equal(
    await page
      .locator(".payout-inbox-form")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  if (process.env.GM_DASHBOARD_SCREENSHOT)
    await page
      .locator(".window-app")
      .screenshot({ path: process.env.GM_DASHBOARD_SCREENSHOT });
  console.log(
    "PASS GM dashboard actions precede outstanding records; rent billing is enabled.",
  );
} finally {
  await browser.close();
}
