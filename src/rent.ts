import { readHqRent, saveHqRentRecord, canPayHq, hqPage } from "./hq-records";
import { MODULE_ID } from "./constants";
import { queueAction, isPrimaryGM } from "./action-coordinator";
import { isCrewActor, accessibleCrewActors } from "./actor-policy";
import { moneyChange } from "./actor-resources";
import { getCampaignDate } from "./calendar";
import { displayDate } from "./date-format";
import { getHeadquarters } from "./headquarters";
import { createUniqueId } from "./id";
import {
  actorPayoutJournal,
  ensureActorPayoutJournal,
  ensureRecordJournal,
  findRecordJournal,
  readRecord,
  writeRecord,
  recordPage,
} from "./journal-records";
import { journalTable, recordEscape as esc } from "./journal-format";
import {
  DEFAULT_RENT_MODIFIERS,
  housingReminder,
  DEFAULT_HOUSING,
  DEFAULT_LIFESTYLES,
  type RentBill,
  parseRentModifiers,
  rentCharge,
  modifierLabel,
  billOutstanding,
  emptyCharacterRent,
  type CharacterRent,
  type RentRate,
  type RentChoice,
  type HqRent,
} from "./rent-model";
export const RENT_MODIFIERS_SETTING = "rentModifiers";
export const RENT_KEY = "rent";
export interface RentConfig {
  housing: RentRate[];
  lifestyles: RentRate[];
  periods: { id: string; date: string }[];
}
export const rentConfig = (): RentConfig => {
  const data = readRecord<RentConfig>(findRecordJournal("rent"), "rentConfig", {
    housing: [],
    lifestyles: [],
    periods: [],
  });
  return {
    ...data,
    housing: (data.housing.length ? data.housing : DEFAULT_HOUSING).map(
      (rate) => ({
        ...rate,
        name: rate.name.replace(/\s*\(corporate[- ]provided\)/gi, ""),
      }),
    ),
    lifestyles: data.lifestyles.length
      ? data.lifestyles
      : structuredClone(DEFAULT_LIFESTYLES),
  };
};
export const rentModifiers = () =>
  parseRentModifiers(
    String(
      game.settings.get(MODULE_ID, RENT_MODIFIERS_SETTING) ??
        DEFAULT_RENT_MODIFIERS.join(", "),
    ),
  );
export const characterRent = (actorId: string): CharacterRent =>
  readRecord(actorPayoutJournal(actorId), RENT_KEY, emptyCharacterRent());
export const hqRent = (actor: FoundryActor): HqRent => readHqRent(actor.id);
function owner(actorId: string): FoundryActor {
  const actor = game.actors.get(actorId);
  if (
    !actor ||
    !isCrewActor(actor) ||
    !game.user ||
    !(game.user.isGM || actor.testUserPermission(game.user, "OWNER"))
  )
    throw new Error("Choose an owned crew character.");
  return actor;
}
function requireGM() {
  if (!isPrimaryGM())
    throw new Error("The first active GM manages rent billing.");
}
export function rentFormula(charge: {
  base: number;
  modifier: number;
  amount: number;
}): string {
  return (
    charge.base.toLocaleString("en-US") +
    " eb " +
    modifierLabel(charge.modifier) +
    " = " +
    charge.amount.toLocaleString("en-US") +
    " eb"
  );
}
export function characterRentHtml(data: CharacterRent): string {
  const config = rentConfig(),
    choice = data.choice;
  const residence = choice.residence.startsWith("hq:")
    ? (() => {
        const id = choice.residence.slice(3);
        const hq = getHeadquarters(false).headquarters.find(
          (h) => h.actorId === id,
        );
        return (
          "@UUID[Actor." + id + "]{" + esc(hq?.name ?? "Headquarters") + "}"
        );
      })()
    : esc(
        config.housing.find((r) => r.id === choice.residence)?.name ??
          "Not selected",
      ) +
      " " +
      modifierLabel(choice.modifier);
  return (
    "<p><strong>Residence:</strong> " +
    residence +
    " · <strong>Lifestyle:</strong> " +
    esc(
      config.lifestyles.find((r) => r.id === choice.lifestyle)?.name ??
        "Not selected",
    ) +
    "</p>" +
    (housingReminder(choice)
      ? "<p><strong>Housing status:</strong> " +
        esc(housingReminder(choice)) +
        "</p>"
      : "") +
    ((data.due?.length ?? 0)
      ? "<p><strong>Rent & Lifestyle task due:</strong> " +
        data.due.map((d) => esc(displayDate(d.date))).join(", ") +
        "</p>"
      : "") +
    journalTable(
      ["Due date", "Charge", "Amount", "Status"],
      data.bills.flatMap((bill) =>
        ["rent", "lifestyle"]
          .filter(
            (key) =>
              !!bill[key as "rent" | "lifestyle"] ||
              (key === "rent" && !!bill.hqId),
          )
          .map((key) => {
            const charge = bill[key as "rent" | "lifestyle"];
            return [
              esc(displayDate(bill.date)),
              esc(
                charge?.name ??
                  (key === "rent" && bill.hqId
                    ? "HQ residence — shared rent"
                    : "Selection required"),
              ),
              charge ? esc(rentFormula(charge)) : "—",
              charge
                ? charge.paid
                  ? "Paid"
                  : "Due"
                : bill.hqId && key === "rent"
                  ? "See HQ"
                  : "Not configured",
            ];
          }),
      ),
    ) +
    journalTable(
      ["Date", "HQ contribution", "Paid", "Status"],
      data.contributions.map((c) => [
        esc(displayDate(c.date)),
        "@UUID[Actor." + c.hqId + "]{" + esc(c.hqName) + "}",
        c.amount + " eb",
        c.status === "pending"
          ? "Payment processing"
          : c.applied +
            " eb applied" +
            (c.refunded ? "; " + c.refunded + " eb refunded" : ""),
      ]),
    ) +
    (data.changes?.length
      ? journalTable(
          ["Date", "Residence/lifestyle increase", "Paid"],
          data.changes.map((c) => [
            esc(displayDate(c.date)),
            esc(c.description),
            c.amount + " eb",
          ]),
        )
      : "") +
    (data.attempt
      ? "<p><strong>Payment needs review:</strong> " +
        esc(data.attempt.reason) +
        "; money " +
        data.attempt.before +
        " → " +
        data.attempt.after +
        " eb.</p>"
      : "") +
    "<details><summary>About this page</summary><p>Residence, due tasks, payment receipts and HQ contributions are stored in flags.pneuma-crewtools.data. The GM marks tasks due; prices are recorded only when the player pays; money uses the native character ledger. HQ contributions settle automatically; no GM approval is required. Editing this text does not change payments.</p></details>"
  );
}
async function saveCharacterRent(actor: FoundryActor, data: CharacterRent) {
  // HQ residents have no separate personal rent payment to confirm.
  if (data.choice.residence.startsWith("hq:")) {
    for (const due of data.due) {
      let bill = data.bills.find((b) => b.period === due.period);
      if (bill?.rent?.paid || bill?.hqId) continue;
      if (!bill) {
        bill = { ...due };
        data.bills.push(bill);
      }
      bill.hqId = data.choice.residence.slice(3);
      delete bill.rent;
    }
    data.due = data.due.filter((d) => {
      const bill = data.bills.find((b) => b.period === d.period);
      return !bill || billOutstanding(bill);
    });
  }
  const journal =
    actorPayoutJournal(actor.id) ?? (await ensureActorPayoutJournal(actor));
  await writeRecord(
    journal,
    RENT_KEY,
    "Rent & Lifestyle",
    data,
    "",
    characterRentHtml(data),
  );
}
async function saveConfig(config: RentConfig) {
  const journal = await ensureRecordJournal("rent", "Rent & Lifestyle", "crew");
  const html =
    journalTable(
      ["Category", "Type", "Monthly cost"],
      [
        ...config.housing.map((r) => ["Rent", esc(r.name), r.cost + " eb"]),
        ...config.lifestyles.map((r) => [
          "Lifestyle",
          esc(r.name),
          r.cost + " eb",
        ]),
      ],
    ) +
    "<p>Billing periods: " +
    config.periods.map((p) => esc(displayDate(p.date))).join(", ") +
    "</p><details><summary>About this page</summary><p>The GM maintains housing and lifestyle rates. Billing periods are identified by campaign year and month; repeating Rent Is Due in the same month does not charge twice. Structured data: flags.pneuma-crewtools.data.</p></details>";
  await writeRecord(journal, "rentConfig", "Rates & Billing", config, "", html);
}
export function saveRentRates(
  housing: RentRate[],
  lifestyles: RentRate[],
): Promise<void> {
  return queueAction(async () => {
    requireGM();
    for (const rates of [housing, lifestyles]) {
      const ids = new Set<string>();
      for (const rate of rates) {
        if (
          !rate.id ||
          ids.has(rate.id) ||
          !rate.name.trim() ||
          rate.name.length > 100 ||
          !Number.isSafeInteger(rate.cost) ||
          rate.cost < 0
        )
          throw new Error(
            "Each rate needs a unique ID, name and nonnegative whole-eb cost.",
          );
        ids.add(rate.id);
      }
    }
    await saveConfig({ ...rentConfig(), housing, lifestyles });
  });
}
function validateChoice(choice: RentChoice) {
  const config = rentConfig();
  if (
    !getHeadquarters(false).headquarters.some(
      (h) => choice.residence === "hq:" + h.actorId,
    ) &&
    !config.housing.some((r) => r.id === choice.residence)
  )
    throw new Error("Choose a rent type or headquarters.");
  if (!rentModifiers().includes(choice.modifier))
    throw new Error("Choose an allowed rent modifier.");
  if (!config.lifestyles.some((r) => r.id === choice.lifestyle))
    throw new Error("Choose a lifestyle.");
}
// Preview only. Prices become Journal receipts when a player pays, not when the GM marks rent due.
export function previewRentBill(
  data: CharacterRent,
  period: { period: string; date: string },
  choice = data.choice,
): RentBill {
  const bill: RentBill = structuredClone(
    data.bills.find((b) => b.period === period.period) ?? period,
  );
  const config = rentConfig();
  if (!bill.rent?.paid && !bill.hqId) {
    const rate = config.housing.find((r) => r.id === choice.residence);
    bill.rent = rate ? rentCharge(rate, choice.modifier) : undefined;
  }
  if (!bill.lifestyle?.paid) {
    const rate = config.lifestyles.find((r) => r.id === choice.lifestyle);
    bill.lifestyle = rate ? rentCharge(rate) : undefined;
  }
  return bill;
}
// An unpaid monthly obligation already charges the selected price. Only settled
// components need a separate upgrade payment; downgrades never offset an increase.
export function previewChoiceChange(data: CharacterRent, choice: RentChoice) {
  const config = rentConfig();
  const pending = (kind: "rent" | "lifestyle") =>
    data.due.some((d) => {
      const bill = data.bills.find((b) => b.period === d.period);
      return kind === "rent"
        ? !bill?.rent?.paid && !bill?.hqId
        : !bill?.lifestyle?.paid;
    });
  const price = (selected: RentChoice, kind: "rent" | "lifestyle") => {
    const rate = (kind === "rent" ? config.housing : config.lifestyles).find(
      (r) =>
        r.id === (kind === "rent" ? selected.residence : selected.lifestyle),
    );
    return rate
      ? rentCharge(rate, kind === "rent" ? selected.modifier : 0).amount
      : 0;
  };
  const rent =
    data.choice.residence && !pending("rent")
      ? Math.max(0, price(choice, "rent") - price(data.choice, "rent"))
      : 0;
  const lifestyle =
    data.choice.lifestyle && !pending("lifestyle")
      ? Math.max(
          0,
          price(choice, "lifestyle") - price(data.choice, "lifestyle"),
        )
      : 0;
  return { rent, lifestyle, amount: rent + lifestyle };
}
function recordChoiceIncrease(before: CharacterRent, after: CharacterRent) {
  const cost = previewChoiceChange(before, after.choice);
  if (cost.amount) {
    const config = rentConfig();
    const description = [
      cost.rent
        ? "Residence: " +
          (config.housing.find((r) => r.id === after.choice.residence)?.name ??
            "HQ") +
          " (+" +
          cost.rent +
          " eb)"
        : "",
      cost.lifestyle
        ? "Lifestyle: " +
          config.lifestyles.find((r) => r.id === after.choice.lifestyle)?.name +
          " (+" +
          cost.lifestyle +
          " eb)"
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    (after.changes ??= []).push({
      date: getCampaignDate(),
      ...cost,
      description,
    });
  }
  return cost.amount;
}
export function saveResidence(
  actorId: string,
  choice: RentChoice,
): Promise<void> {
  return queueAction(async () => {
    const actor = owner(actorId),
      before = characterRent(actorId),
      data = structuredClone(before);
    if (data.attempt)
      throw new Error("An interrupted payment needs GM review first.");
    validateChoice(choice);
    data.choice = {
      ...choice,
      vehicleHasBed:
        choice.residence === "vehicle" && choice.vehicleHasBed === true,
    };
    const amount = recordChoiceIncrease(before, data);
    if (amount)
      await payAndSave(
        actor,
        before,
        data,
        amount,
        "Residence/lifestyle change — " + data.changes!.at(-1)!.description,
      );
    else await saveCharacterRent(actor, data);
  });
}
// Money and its Journal receipt are separate Foundry writes; restore both on ordinary failure.
async function payAndSave(
  actor: FoundryActor,
  before: CharacterRent,
  after: CharacterRent,
  amount: number,
  reason: string,
) {
  if (before.attempt)
    throw new Error("An interrupted rent payment needs GM review.");
  const change = moneyChange(actor, -amount, reason);
  await saveCharacterRent(actor, {
    ...before,
    attempt: {
      reason,
      before: change.change.before,
      after: change.change.after,
    },
  });
  let updated = false;
  try {
    await actor.update(change.update);
    updated = true;
    await saveCharacterRent(actor, after);
  } catch (error) {
    try {
      if (updated) await actor.update(change.restore);
      await saveCharacterRent(actor, before);
    } catch (rollback) {
      throw new Error(
        "Rent payment rollback incomplete. Inspect the character money and Rent & Lifestyle Journal before retrying.",
        { cause: rollback },
      );
    }
    throw error;
  }
}
export function payPersonalRent(
  actorId: string,
  period: string,
  kind: "rent" | "lifestyle",
  choice?: RentChoice,
): Promise<void> {
  return queueAction(async () => {
    const actor = owner(actorId),
      before = characterRent(actorId),
      after = structuredClone(before);
    const due = after.due?.find((d) => d.period === period);
    const previous = after.bills.find((b) => b.period === period);
    if (previous?.[kind]?.paid || (kind === "rent" && previous?.hqId))
      throw new Error("This charge is already paid.");
    if (!due) throw new Error("Rent is not marked due for this period.");
    const selected = choice ?? after.choice;
    validateChoice(selected);
    after.choice = {
      ...selected,
      vehicleHasBed:
        selected.residence === "vehicle" && selected.vehicleHasBed === true,
    };
    const changeAmount = recordChoiceIncrease(before, after);
    const preview = previewRentBill(after, due, selected);
    const receipt: RentBill = previous ?? { ...due };
    let amount = 0,
      name = "HQ residence";
    if (kind === "rent" && selected.residence.startsWith("hq:"))
      receipt.hqId = selected.residence.slice(3);
    else {
      const charge = preview[kind];
      if (!charge) throw new Error("Choose a " + kind + ".");
      charge.paid = true;
      receipt[kind] = charge;
      amount = charge.amount;
      name = charge.name;
    }
    if (!previous) after.bills.push(receipt);
    if (!billOutstanding(receipt))
      after.due = after.due.filter((d) => d.period !== period);
    await payAndSave(
      actor,
      before,
      after,
      amount + changeAmount,
      (kind === "rent" ? "Rent" : "Lifestyle") +
        " — " +
        name +
        " — " +
        displayDate(due.date) +
        (changeAmount ? "; " + after.changes!.at(-1)!.description : ""),
    );
  });
}
async function saveHqRent(actor: FoundryActor, data: HqRent) {
  await saveHqRentRecord(actor, data);
}
export function setHqRent(
  actorId: string,
  typeId: string,
  modifier: number,
): Promise<void> {
  return queueAction(async () => {
    requireGM();
    if (
      !getHeadquarters(false).headquarters.some((hq) => hq.actorId === actorId)
    )
      throw new Error("Choose a headquarters.");
    const actor = game.actors.get(actorId)!;
    if (
      !rentConfig().housing.some((r) => r.id === typeId) ||
      !rentModifiers().includes(modifier)
    )
      throw new Error("Choose a rent type and allowed modifier.");
    await saveHqRent(actor, { ...hqRent(actor), typeId, modifier });
  });
}
export function issueRent(): Promise<string> {
  return queueAction(async () => {
    requireGM();
    const config = rentConfig(),
      date = getCampaignDate(),
      id = date.slice(0, 7);
    if (!config.housing.length || !config.lifestyles.length)
      throw new Error(
        "Add the rent and lifestyle charts in settings before marking rent due.",
      );
    const period = config.periods.find((p) => p.id === id) ?? { id, date };
    if (!config.periods.some((p) => p.id === id)) {
      config.periods.push(period);
      await saveConfig(config);
    }
    for (const actor of game.actors) {
      // A due-date action provisions only assigned characters or characters already used by Crew Tools.
      if (
        !isCrewActor(actor) ||
        !(
          actorPayoutJournal(actor.id) ||
          Array.from(game.users).some(
            (u) => !u.isGM && u.character?.id === actor.id,
          )
        )
      )
        continue;
      const data = characterRent(actor.id);
      data.due ??= [];
      if (
        !data.due.some((d) => d.period === id) &&
        !data.bills.some((b) => b.period === id && !billOutstanding(b))
      )
        data.due.push({ period: id, date });
      await saveCharacterRent(actor, data);
    }
    for (const hq of getHeadquarters(false).headquarters) {
      const actor = game.actors.get(hq.actorId);
      if (!actor) continue;
      const data = hqRent(actor),
        rate = config.housing.find((r) => r.id === data.typeId);
      if (rate && !data.bills.some((bill) => bill.period === id)) {
        data.bills.push({
          period: id,
          date,
          charge: rentCharge(rate, data.modifier),
          paid: 0,
          contributions: [],
        });
        await saveHqRent(actor, data);
      }
    }
    return displayDate(period.date);
  });
}
export function contributeRent(
  actorId: string,
  hqId: string,
  period: string,
  amount: number,
): Promise<void> {
  return queueAction(async () => {
    const actor = owner(actorId),
      hq = getHeadquarters(false).headquarters.find((h) => h.actorId === hqId),
      hqActor = game.actors.get(hqId);
    const bill =
      hqActor && hqRent(hqActor).bills.find((b) => b.period === period);
    if (
      !hq ||
      !bill ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > bill.charge.amount - bill.paid
    )
      throw new Error(
        "Enter a positive whole-eb contribution no greater than the remaining HQ rent.",
      );
    const before = characterRent(actorId),
      after = structuredClone(before);
    const pending = before.contributions
      .filter(
        (c) => c.hqId === hqId && c.period === period && c.status === "pending",
      )
      .reduce((sum, c) => sum + c.amount, 0);
    if (amount + pending > bill.charge.amount - bill.paid)
      throw new Error(
        "Your pending payments already cover some or all of this rent.",
      );
    after.contributions.push({
      id: createUniqueId(),
      hqId,
      hqName: hq.name,
      period,
      amount,
      date: getCampaignDate(),
      status: "pending",
    });
    await payAndSave(
      actor,
      before,
      after,
      amount,
      "HQ rent contribution — " + hq.name + " — " + displayDate(bill.date),
    );
    await reconcileRentPayments(actorId);
  });
}
export function reconcileRent(): Promise<void> {
  return queueAction(() => reconcileRentPayments());
}
// Run inside the existing local queue; owners can settle their own payments directly.
async function reconcileRentPayments(actorId?: string): Promise<void> {
  if (game.user?.isGM && !isPrimaryGM()) return;
  if (!game.user) return;
  for (const actor of game.actors) {
    if (actorId && actor.id !== actorId) continue;
    if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER"))
      continue;
    if (!actorPayoutJournal(actor.id)) continue;
    let data = characterRent(actor.id);
    if (data.attempt) continue;
    for (const pending of data.contributions.filter(
      (c) => c.status === "pending",
    )) {
      if (
        !pending.id ||
        !Number.isSafeInteger(pending.amount) ||
        pending.amount <= 0
      )
        throw new Error(
          "Invalid pending rent contribution in " + actor.name + "'s Journal.",
        );
      if (
        !getHeadquarters(false).headquarters.some(
          (hq) => hq.actorId === pending.hqId,
        )
      )
        continue;
      const hq = game.actors.get(pending.hqId);
      if (!hq || !canPayHq(hq.id)) continue;
      const state = hqRent(hq),
        bill = state?.bills.find((b) => b.period === pending.period);
      if (!hq || !state || !bill) continue;
      let receipt = bill.contributions.find((c) => c.id === pending.id);
      if (!receipt) {
        const applied = Math.min(
          pending.amount,
          Math.max(0, bill.charge.amount - bill.paid),
        );
        receipt = {
          id: pending.id,
          actorId: actor.id,
          actorName: actor.name,
          amount: applied,
          refund: pending.amount - applied,
        };
        bill.contributions.push(receipt);
        bill.paid += applied;
        await saveHqRent(hq, state);
      }
      if (
        receipt.actorId !== actor.id ||
        receipt.amount + receipt.refund !== pending.amount
      )
        throw new Error(
          "HQ rent receipt does not match " +
            actor.name +
            "'s pending payment. Review the Journals.",
        );
      const after = structuredClone(data),
        result = after.contributions.find((c) => c.id === pending.id)!;
      result.status = "confirmed";
      result.applied = receipt.amount;
      result.refunded = receipt.refund;
      if (receipt.refund)
        await payAndSave(
          actor,
          data,
          after,
          -receipt.refund,
          "HQ rent overpayment refund — " + pending.hqName,
        );
      else await saveCharacterRent(actor, after);
      data = after;
    }
  }
}
function rentSnapshot(actorId: string): CharacterRent {
  return (
    (recordPage(actorPayoutJournal(actorId), RENT_KEY)?.getFlag?.(
      MODULE_ID,
      "data",
    ) as CharacterRent | undefined) ?? emptyCharacterRent()
  );
}
function sharedRentDue(): boolean {
  return getHeadquarters(false).headquarters.some((hq) => {
    const state = hqPage(hq.actorId)?.getFlag?.(MODULE_ID, "rent") as
      HqRent | undefined;
    return state?.bills.some((b) => b.paid < b.charge.amount);
  });
}
export function rentStatus(actorId: string) {
  const data = rentSnapshot(actorId),
    pending = data.contributions
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + c.amount, 0);
  return {
    due: (data.due?.length ?? 0) > 0 || sharedRentDue(),
    pending,
    needsReview: !!data.attempt,
    residence: data.choice.residence.startsWith("hq:")
      ? (getHeadquarters(false).headquarters.find(
          (hq) => hq.actorId === data.choice.residence.slice(3),
        )?.name ?? "Not selected")
      : (rentConfig().housing.find((rate) => rate.id === data.choice.residence)
          ?.name ?? "Not selected"),
    lifestyle:
      rentConfig().lifestyles.find((rate) => rate.id === data.choice.lifestyle)
        ?.name ?? "Not selected",
    housingReminder: housingReminder(data.choice),
  };
}
export function rentNeedsAttention(): boolean {
  const actors = new Set(accessibleCrewActors().map((actor) => actor.id));
  if (!actors.size) return false;
  if (sharedRentDue()) return true;
  return Array.from(game.journal).some((journal) => {
    if (
      journal.getFlag?.(MODULE_ID, "recordKind") !== "character" ||
      !actors.has(String(journal.getFlag?.(MODULE_ID, "actorId")))
    )
      return false;
    const data = recordPage(journal, RENT_KEY)?.getFlag?.(MODULE_ID, "data") as
      CharacterRent | undefined;
    return (
      !!data &&
      (!!data.attempt ||
        (data.due?.length ?? 0) > 0 ||
        data.contributions.some((c) => c.status === "pending"))
    );
  });
}
export function registerRentReconciliation(): void {
  const reconcile = () => {
    if (game.user && (!game.user.isGM || isPrimaryGM()))
      void reconcileRent().catch((error) =>
        ui.notifications.error(String(error)),
      );
  };
  Hooks.once("ready", reconcile);
  Hooks.on("userConnected", reconcile);
  // Ignore our own writes so an unsuccessful refund cannot create an automatic retry loop.
  Hooks.on("updateJournalEntryPage", (page, _changes, _options, userId) => {
    if (
      userId !== game.user?.id &&
      page.getFlag?.(MODULE_ID, "recordKey") === RENT_KEY
    )
      reconcile();
  });
  Hooks.on("createJournalEntryPage", (page, _options, userId) => {
    if (
      userId !== game.user?.id &&
      page.getFlag?.(MODULE_ID, "recordKey") === RENT_KEY
    )
      reconcile();
  });
}
