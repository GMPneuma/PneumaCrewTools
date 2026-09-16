// Snapshot readable result text; never retain executable table HTML in the log.
export function tableResultText(value: string | undefined): string {
  const text = value ?? "";
  if (!/[<&]/.test(text)) return text;
  const element = document.createElement("div");
  element.innerHTML = text.replace(
    /<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])>/gi,
    "$&\n",
  );
  return (element.textContent ?? "").trim();
}

// Never normalize, reset, draw, or update a GM-owned RollTable.
export async function rollTableReadOnly(table: FoundryRollTable) {
  if (table.formula?.trim()) {
    const draw = await table.roll({ recursive: false });
    return { ...draw, payoutEnabled: true };
  }
  // Foundry roll() normalizes an empty formula by writing to the table. Instead,
  // choose from its existing weights in memory; this fallback cannot pay rewards.
  const candidates = Array.from(table.results ?? []).filter(
    (r) => !r.drawn && (r.weight ?? 1) > 0,
  );
  const total = candidates.reduce((sum, r) => sum + (r.weight ?? 1), 0);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    candidates.some((r) => !Number.isSafeInteger(r.weight ?? 1))
  )
    throw new Error(
      "This RollTable has no available results with usable weights.",
    );
  const roll = await new Roll("1d" + total).evaluate();
  let remaining = roll.total;
  const result = candidates.find((r) => (remaining -= r.weight ?? 1) <= 0);
  return { roll, results: result ? [result] : [], payoutEnabled: false };
}

// GM setup validation is read-only: evaluate formula bounds without drawing or
// normalizing results, and reject options players could not use.
export async function validateActivityTable(
  table: FoundryRollTable,
): Promise<void> {
  const label = 'RollTable "' + table.name + '": ';
  const formula = table.formula?.trim();
  if (!formula)
    throw new Error(
      label +
        "set a dice formula, such as 1d6, in Foundry before selecting it.",
    );
  let valid = false;
  try {
    valid = !formula.includes("@") && Roll.validate(formula);
  } catch {
    /* Native validation may throw for malformed terms. */
  }
  if (!valid)
    throw new Error(
      label +
        "the dice formula is invalid or requires external data. Fix it in Foundry first.",
    );
  let minimum: number, maximum: number;
  try {
    minimum = (
      await new Roll(formula).evaluate({
        minimize: true,
        allowInteractive: false,
      })
    ).total;
    maximum = (
      await new Roll(formula).evaluate({
        maximize: true,
        allowInteractive: false,
      })
    ).total;
  } catch {
    throw new Error(
      label + "the dice formula cannot be evaluated. Fix it in Foundry first.",
    );
  }
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum
  )
    throw new Error(
      label +
        "the dice formula must produce a finite whole-number result range.",
    );
  const results = Array.from(table.results ?? []);
  if (!results.length) throw new Error(label + "add at least one result.");
  for (const result of results) {
    if (
      !result.range ||
      result.range.length !== 2 ||
      !result.range.every(Number.isSafeInteger) ||
      result.range[0] > result.range[1]
    )
      throw new Error(
        label +
          "a result has an invalid range. Fix its From/To values in Foundry.",
      );
  }
  const ranges = results
    .filter((r) => !r.drawn)
    .map((r) => r.range!)
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length)
    throw new Error(
      label + "all results are marked drawn. Reset the table in Foundry first.",
    );
  let next = minimum;
  for (const [low, high] of ranges) {
    if (high < next) continue;
    if (low > next) break;
    if (high >= maximum) {
      next = maximum + 1;
      break;
    }
    next = high + 1;
  }
  if (next <= maximum)
    throw new Error(
      label +
        "available result ranges do not cover the dice formula (" +
        minimum +
        "–" +
        maximum +
        "). Fix gaps or reset drawn results in Foundry.",
    );
  const denied = Array.from(game.users).filter(
    (user) =>
      !user.isGM && table.testUserPermission?.(user, "OBSERVER") !== true,
  );
  if (denied.length)
    throw new Error(
      label +
        "grant Observer access in Foundry to: " +
        denied.map((user) => user.name).join(", ") +
        ".",
    );
}
