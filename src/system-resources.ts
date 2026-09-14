// Cyberpunk RED resource paths are isolated here for system upgrades.
export function nativeValue(actor: FoundryActor, path: string): unknown {
  return valueAt(actor.system, path);
}
export function hpUpdate(value: number): Record<string, unknown> {
  return { "system.derivedStats.hp.value": value };
}

export function valueAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

export function numberAt(value: unknown, path: string): number {
  const result = valueAt(value, path);
  if (typeof result !== "number" || !Number.isFinite(result))
    throw new Error(`Actor is missing numeric system.${path}.`);
  return result;
}

export function arrayAt(value: unknown, path: string): unknown[] {
  const result = valueAt(value, path);
  if (!Array.isArray(result))
    throw new Error(`Actor is missing system.${path}.`);
  return result;
}
