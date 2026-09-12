/** Create a module identifier on secure and non-secure Foundry hosts. */
export function createUniqueId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return foundry.utils.randomID(32);
}
