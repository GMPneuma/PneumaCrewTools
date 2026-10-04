import { recordEscape as esc } from "./journal-format";
import { medtechRole } from "./medtech-system";
import { MODULE_ID } from "./constants";

export interface TreatmentChoice {
  name: string;
  skill: string;
  dv: number;
  stage: "Stabilize" | "QuickFix" | "Treatment";
  permanent?: boolean;
}
interface PatientToken {
  name: string;
  document: { uuid: string };
  actor?: { hasPlayerOwner?: boolean };
  isVisible?: boolean;
}
type NativeRoll = NonNullable<
  ReturnType<NonNullable<FoundryItem["createRoll"]>>
> & {
  rollTitle: string;
  rollCard: string;
  luck?: number;
  criticalCard?: boolean;
  wasCritical(): boolean;
};
type NativeItem = FoundryItem & {
  confirmRoll?(roll: NativeRoll): Promise<NativeRoll>;
};

// Read every supported skill DV from the native injury, including QuickFix-only cures.
export function injuryTreatmentChoices(injury: FoundryItem): TreatmentChoice[] {
  const system = injury.system as Record<string, Record<string, unknown>>;
  return (
    [
      ["QuickFix", "quickFix", ["First Aid", "Paramedic"]],
      ["Treatment", "treatment", ["Paramedic", "Surgery"]],
    ] as const
  ).flatMap(([stage, path, skills]) => {
    if (path === "treatment" && system.treatment?.type === "quickFix")
      return [];
    return skills.flatMap((skill) => {
      const dv = Number(system[path]?.["dv" + skill.replace(" ", "")]);
      return Number.isSafeInteger(dv) && dv > 0
        ? [
            {
              name: injury.name,
              stage,
              skill,
              dv,
              permanent:
                stage === "QuickFix" && system.treatment?.type === "quickFix",
            },
          ]
        : [];
    });
  });
}
function nativeChoice(actor: FoundryActor, choice: TreatmentChoice) {
  if (choice.skill !== "Surgery") {
    const item = Array.from(actor.items ?? []).find(
      (item) =>
        item.type === "skill" &&
        item.name.trim().toLowerCase() === choice.skill.toLowerCase(),
    );
    return item
      ? { item: item as NativeItem, type: "skill", title: item.name }
      : undefined;
  }
  const item = medtechRole(actor) as NativeItem | undefined;
  const ability = (
    item?.system as { abilities?: { name: string; hasRoll?: boolean }[] }
  )?.abilities?.find((a) => a.hasRoll && a.name === "Surgery Skill");
  return item && ability
    ? {
        item,
        type: "roleAbility",
        title: ability.name,
        options: { rollSubType: "subRoleAbility", subRoleName: ability.name },
      }
    : undefined;
}
export async function rollTreatment(
  actor: FoundryActor,
  choice: TreatmentChoice,
  patient: { name: string; tokenUuid?: string },
  event: Pick<MouseEvent, "shiftKey">,
): Promise<void> {
  if (!game.user || !actor.testUserPermission(game.user, "OWNER"))
    throw new Error("Choose a character you own to provide treatment.");
  if (!patient.name.trim())
    throw new Error("Select a patient or enter a patient name.");
  const native = nativeChoice(actor, choice);
  if (!native?.item.createRoll || !native.item.confirmRoll)
    throw new Error("The native treatment skill or role roll is unavailable.");
  let roll = native.item.createRoll(
    native.type,
    actor,
    native.options,
  ) as NativeRoll;
  roll.rollTitle = `${choice.stage} — ${choice.name} — ${choice.skill} DV${choice.dv}`;
  if (
    !(await roll.handleRollDialog(
      { type: "crewtools-treatment", ctrlKey: event.shiftKey, metaKey: false },
      actor,
      native.item,
    ))
  )
    return;
  roll = await native.item.confirmRoll(roll);
  const luck = Number(roll.luck ?? 0);
  if (!Number.isSafeInteger(luck) || luck < 0)
    throw new Error("Invalid Luck spending.");
  if (luck) {
    const available = (
      actor.system as { stats?: { luck?: { value?: number } } }
    ).stats?.luck?.value;
    if (!Number.isSafeInteger(available) || available! < luck)
      throw new Error("Not enough Luck for this treatment roll.");
    await actor.update({ "system.stats.luck.value": available! - luck });
  }
  await roll.roll();
  if (!Number.isFinite(roll.resultTotal))
    throw new Error("The treatment roll returned no total.");
  roll.criticalCard = roll.wasCritical();
  const html = await renderTemplate(roll.rollCard, roll);
  const content =
    html +
    `<section class="crewtools-treatment-result"><p>${esc(actor.name)} → Treatment → ${esc(patient.name)}</p><p><strong>${roll.resultTotal > choice.dv ? "Success" : "Fail"}</strong> · ${roll.resultTotal} vs DV${choice.dv}</p></section>`;
  const data = {
    content,
    speaker: { actor: actor.id, alias: actor.name },
    flags: {
      [MODULE_ID]: {
        treatment: {
          healerActorId: actor.id,
          patientName: patient.name,
          patientTokenUuid: patient.tokenUuid,
          ...choice,
          total: roll.resultTotal,
        },
      },
    },
  };
  ChatMessage.applyRollMode(
    data,
    String(game.settings.get("core", "rollMode") ?? "publicroll"),
  );
  await ChatMessage.create(data);
}

export function treatmentHtml(
  injuries: Record<"body" | "head", FoundryItem[]>,
  patients: PatientToken[],
  selected = "",
): string {
  const slot = (stage: string, skill: string) =>
    `<button type="button" data-treatment-stage="${stage}" data-treatment-skill="${skill}">${skill}</button>`;
  const section = (location: "body" | "head") =>
    `<section class="pneuma-treatment-section" data-treatment-location="${location}"><h3><i class="fas ${location === "body" ? "fa-user" : "fa-brain"}" aria-hidden="true"></i>${location === "body" ? "Body Crits" : "Head Crits"}</h3><div class="pneuma-treatment-columns"><div><h4>Crit</h4><select data-treatment-select aria-label="${location} critical injury">${injuries[location].map((item, i) => `<option value="${i}">${esc(item.name)}</option>`).join("")}</select></div><div><h4>QuickFix</h4><div class="pneuma-treatment-options">${slot("QuickFix", "First Aid")}${slot("QuickFix", "Paramedic")}</div></div><div><h4>Treatment</h4><div class="pneuma-treatment-options">${slot("Treatment", "Paramedic")}${slot("Treatment", "Surgery")}</div></div></div></section>`;
  return `<div class="pneuma-treatment-patient-picker"><label>Patient <select data-treatment-patient><option value="">Select patient…</option>${patients.map((token) => `<option value="${esc(token.document.uuid)}"${selected === token.document.uuid ? " selected" : ""}>${esc(token.name)}</option>`).join("")}<option value="custom">Type a patient name…</option></select></label><input type="text" data-treatment-patient-name placeholder="Patient name" aria-label="Patient name" hidden></div><div class="pneuma-treatment-list"><section class="pneuma-treatment-section" data-treatment-location="stabilize"><h3><i class="fas fa-plus" aria-hidden="true"></i>Stabilize</h3><table class="pneuma-stabilize-table"><thead><tr><th>Wound State</th><th>First Aid</th><th>Paramedic</th></tr></thead><tbody>${(
    [
      ["Lightly Wounded", 10],
      ["Seriously Wounded", 13],
      ["Mortally Wounded", 15],
    ] as const
  )
    .map(
      ([name, dv]) =>
        `<tr><td>${name}</td>${["First Aid", "Paramedic"].map((skill) => `<td><button type="button" data-treatment-stage="Stabilize" data-treatment-skill="${skill}" data-wound-name="${name}" data-wound-dv="${dv}">${skill} DV${dv}</button></td>`).join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></section>${section("body")}${section("head")}</div>`;
}

export async function openTreatment(actorId: string): Promise<void> {
  const actor = game.actors.get(actorId);
  if (
    !actor ||
    !["character", "mook"].includes(actor.type) ||
    !game.user ||
    !actor.testUserPermission(game.user, "OWNER")
  )
    throw new Error("Choose a character you own to provide treatment.");
  const injuries = Object.fromEntries(
    await Promise.all(
      (["body", "head"] as const).map(async (location) => {
        const pack = Array.from(game.packs ?? []).find(
          (pack) =>
            pack.collection ===
            "cyberpunk-red-core.core_critical-injuries-" + location,
        );
        if (!pack)
          throw new Error(
            `The native ${location} critical injury compendium is unavailable.`,
          );
        return [
          location,
          (await pack.getDocuments())
            .filter((item) => item.type === "criticalInjury")
            .sort((a, b) => a.name.localeCompare(b.name)),
        ];
      }),
    ),
  ) as Record<"body" | "head", FoundryItem[]>;
  const canvas = (
    globalThis as unknown as {
      canvas?: { tokens?: { placeables?: PatientToken[] } };
    }
  ).canvas;
  const patients = (canvas?.tokens?.placeables ?? [])
    .filter(
      (token) =>
        token.actor?.hasPlayerOwner && (game.user?.isGM || token.isVisible),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const targets = Array.from(
    (game.user as FoundryUser & { targets?: Iterable<PatientToken> }).targets ??
      [],
  );
  const selected =
    targets.length === 1 && patients.includes(targets[0]!)
      ? targets[0]!.document.uuid
      : "";
  let busy = false;
  new Dialog(
    {
      title: "Treatment — " + actor.name,
      content: treatmentHtml(injuries, patients, selected),
      buttons: {},
      render: (html) => {
        const root = html[0]!;
        const patientSelect = root.querySelector<HTMLSelectElement>(
          "[data-treatment-patient]",
        )!;
        const patientName = root.querySelector<HTMLInputElement>(
          "[data-treatment-patient-name]",
        )!;
        patientSelect.addEventListener("change", () => {
          patientName.hidden = patientSelect.value !== "custom";
          if (!patientName.hidden) patientName.focus();
        });
        const choiceFor = (
          section: HTMLElement,
          button: HTMLButtonElement,
        ): TreatmentChoice | undefined => {
          const skill = button.dataset.treatmentSkill!,
            stage = button.dataset.treatmentStage!;
          const location = section.dataset.treatmentLocation!;
          if (location === "stabilize")
            return {
              name: button.dataset.woundName!,
              skill,
              dv: Number(button.dataset.woundDv),
              stage: "Stabilize",
            };
          const index = Number(
            section.querySelector<HTMLSelectElement>("select")!.value,
          );
          const injury = injuries[location as "body" | "head"][index];
          return (
            injury &&
            injuryTreatmentChoices(injury).find(
              (row) => row.skill === skill && row.stage === stage,
            )
          );
        };
        const sections = Array.from(
          root.querySelectorAll<HTMLElement>("[data-treatment-location]"),
        );
        const update = () =>
          sections.forEach((section) =>
            section
              .querySelectorAll<HTMLButtonElement>("button")
              .forEach((button) => {
                const choice = choiceFor(section, button);
                button.textContent =
                  button.dataset.treatmentSkill +
                  (choice ? " DV" + choice.dv : " —");
                button.disabled =
                  busy || !choice || !nativeChoice(actor, choice);
                button.title = choice
                  ? choice.permanent
                    ? "Permanent treatment via QuickFix"
                    : ""
                  : "Not available for this injury";
              }),
          );
        sections.forEach((section) => {
          section.querySelector("select")?.addEventListener("change", update);
          section
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) =>
              button.addEventListener("click", (event) => {
                if (busy || button.disabled) return;
                const choice = choiceFor(section, button);
                if (!choice) return;
                const token = patients.find(
                  (patient) => patient.document.uuid === patientSelect.value,
                );
                const patient =
                  patientSelect.value === "custom"
                    ? { name: patientName.value.trim() }
                    : {
                        name: token?.name ?? "",
                        tokenUuid: token?.document.uuid,
                      };
                busy = true;
                update();
                void rollTreatment(actor, choice, patient, event)
                  .catch((error) => ui.notifications.error(String(error)))
                  .finally(() => {
                    busy = false;
                    update();
                  });
              }),
            );
        });
        update();
      },
    },
    { width: 720, classes: ["pneuma-crewtools", "crewtools-treatment"] },
  ).render(true);
}
