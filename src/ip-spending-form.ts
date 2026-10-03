import { MODULE_ID } from "./constants";
import { CrewToolsForm } from "./foundry-form";
import { numberAt } from "./system-resources";
import {
  actorUpgrades,
  applyIpUpgrades,
  upgradeCost,
  type IpUpgrade,
} from "./ip-spending";

export class IpSpendingForm extends CrewToolsForm {
  private drafts: IpUpgrade[];
  private balance: number;
  private filter = "all";
  private search = "";
  private busy = false;
  private root?: HTMLElement;
  private roles: FoundryItem[] = [];
  constructor(private actor: FoundryActor) {
    super();
    this.drafts = actorUpgrades(actor);
    this.balance = numberAt(actor.system, "improvementPoints.value");
  }
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-spend-ip",
      title: "Spend IP",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/ip-spending.hbs`,
      width: 850,
      height: 680,
      resizable: true,
      closeOnSubmit: false,
    };
  }
  override async getData() {
    const total = this.drafts.reduce(
      (n, d) => n + upgradeCost(d.from, d.to, d.rate),
      0,
    );
    const rows = this.drafts.map((d) => ({
      ...d,
      cost: upgradeCost(d.from, d.to, d.rate),
      next: (d.to + 1) * d.rate,
      canAdd:
        !this.busy &&
        !d.blockedReason &&
        d.to < 10 &&
        total + (d.to + 1) * d.rate <= this.balance,
      canRemove: !this.busy && !d.blockedReason && d.to > d.from,
      doubled: d.rate === 40,
    }));
    return {
      actorName: this.actor.name,
      balance: this.balance,
      total,
      remaining: this.balance - total,
      skills: rows.filter((d) => d.kind === "skill"),
      roles: rows.filter((d) => d.kind === "role"),
      receipt: rows.filter((d) => d.cost > 0),
      canImprove: !this.busy && total > 0 && total <= this.balance,
      canRecruit:
        !this.busy &&
        !this.drafts.some((d) => d.source) &&
        this.drafts.filter((d) => d.kind === "role").every((d) => d.to >= 4),
      availableRoles: this.roles
        .filter(
          (r) =>
            !this.drafts.some(
              (d) =>
                d.kind === "role" &&
                d.name.toLowerCase() === r.name.toLowerCase(),
            ),
        )
        .map((r) => ({ id: r.uuid, name: r.name })),
    };
  }
  private filterSkills(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>("[data-ip-skill]").forEach((row) => {
      const rank = Number(row.dataset.rank);
      row.hidden = !(
        (this.filter === "all" ||
          (this.filter === "positive" ? rank > 0 : rank === 0)) &&
        (row.dataset.name ?? "")
          .toLowerCase()
          .includes(this.search.toLowerCase())
      );
    });
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    this.root = root;
    const search = root.querySelector<HTMLInputElement>("[data-ip-search]");
    const filter = root.querySelector<HTMLSelectElement>("[data-ip-filter]");
    if (search) {
      search.value = this.search;
      search.addEventListener("input", () => {
        this.search = search.value;
        this.filterSkills(root);
      });
    }
    if (filter) {
      filter.value = this.filter;
      filter.addEventListener("change", () => {
        this.filter = filter.value;
        this.filterSkills(root);
      });
    }
    this.filterSkills(root);
    root
      .querySelectorAll<HTMLButtonElement>("[data-ip-change]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          if (this.busy) return;
          const draft = this.drafts.find((d) => d.id === button.dataset.id);
          if (!draft || draft.blockedReason) return;
          const to = draft.to + Number(button.dataset.ipChange);
          if (to < draft.from || to > 10) return;
          const total = this.drafts.reduce(
            (n, d) => n + upgradeCost(d.from, d === draft ? to : d.to, d.rate),
            0,
          );
          if (total > this.balance) return;
          draft.to = to;
          if (draft.source && to === 0)
            this.drafts = this.drafts.filter((d) => d !== draft);
          this.render(false);
        }),
      );
    root.querySelector("[data-ip-recruit]")?.addEventListener("click", () => {
      if (this.busy) return;
      void this.recruit(root).catch((e) => ui.notifications.error(String(e)));
    });
  }
  private async recruit(root: HTMLElement) {
    if (!this.roles.length) {
      this.busy = true;
      this.render(false);
      try {
        const packs = Array.from(game.packs ?? []).filter(
          (p) =>
            p.documentName === "Item" &&
            p.collection === "cyberpunk-red-core.core_roles",
        );
        const documents = (
          await Promise.all(packs.map((p) => p.getDocuments()))
        ).flat();
        this.roles = documents
          .filter((i) => i.type === "role")
          .filter(
            (r, index, all) =>
              all.findIndex(
                (i) => i.name.toLowerCase() === r.name.toLowerCase(),
              ) === index,
          )
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!this.roles.length)
          throw new Error(
            "No roles found in the Cyberpunk RED system compendiums.",
          );
      } finally {
        this.busy = false;
        this.render(false);
      }
      return;
    }
    if (
      this.drafts.some((d) => d.source) ||
      this.drafts.filter((d) => d.kind === "role").some((d) => d.to < 4)
    )
      throw new Error("Reach rank 4 in your current roles first.");
    const uuid =
      root.querySelector<HTMLSelectElement>("[data-ip-new-role]")?.value;
    const role = this.roles.find((r) => r.uuid === uuid);
    if (
      !role ||
      this.drafts.some(
        (d) =>
          d.kind === "role" && d.name.toLowerCase() === role.name.toLowerCase(),
      )
    )
      throw new Error("Choose another role.");
    if (
      this.drafts.reduce((n, d) => n + upgradeCost(d.from, d.to, d.rate), 0) +
        60 >
      this.balance
    )
      throw new Error("Not enough IP to add a role.");
    this.drafts.push({
      id: role.uuid!,
      name: role.name,
      kind: "role",
      ability: String(
        (role.system as { mainRoleAbility?: string }).mainRoleAbility ?? "",
      ),
      from: 0,
      to: 1,
      rate: 60,
      source: role.toObject(),
    });
    this.render(false);
  }
  override async _updateObject(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.root
      ?.querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => {
        button.disabled = true;
      });
    let success = false;
    try {
      await applyIpUpgrades(this.actor, this.drafts, this.balance);
      success = true;
      ui.notifications.info("IP improvements applied.");
      await this.close();
    } catch (e) {
      ui.notifications.error(String(e));
    } finally {
      this.busy = false;
      if (!success) this.render(false);
    }
  }
}

export function openIpSpending(actorId: string): void {
  const actor = game.actors.get(actorId);
  if (!actor) return;
  try {
    new IpSpendingForm(actor).render(true);
  } catch (e) {
    ui.notifications.error(String(e));
  }
}
