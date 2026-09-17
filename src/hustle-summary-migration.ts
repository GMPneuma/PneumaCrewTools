import { MODULE_ID } from "./constants";

// Fingerprints identify untouched pre-summary defaults without retaining their text.
const LEGACY_ROWS: Record<string, string[]> = {
  Rockerboy: [
    "205:c9b1751f:43cbe41f",
    "223:b75d2098:6bb7663c",
    "273:fc89fbb5:10053d5d",
    "279:1b81e8b8:fd31b45a",
    "221:60654395:8abeccfb",
    "241:378f8634:2e0017f8",
  ],
  Solo: [
    "217:cd0d4373:239d8cdf",
    "219:ccaf66d6:7aa443dc",
    "211:c9e7e19b:f3e405bd",
    "247:31ca0a82:6b0697a",
    "235:f89b13bf:1581c11b",
    "249:3453e3c6:fbe17c98",
  ],
  Netrunner: [
    "237:698b451:9a511e3f",
    "257:e2ac6dd4:a61b41bc",
    "261:888c3b93:4e685dfd",
    "281:3e671088:f1643a1a",
    "309:489508b3:d48ca31b",
    "293:5f5849d8:1e561b38",
  ],
  Tech: [
    "187:b45205df:b6700d5f",
    "257:600026f2:ea6bf69c",
    "317:3857257f:42337f7d",
    "259:c669422:70e118ba",
    "255:5a982ae7:342d19b",
    "265:46e73b9a:367ce6d8",
  ],
  Medtech: [
    "229:de17e343:abe0595f",
    "255:9409742:cbd0c11c",
    "285:6cfbb1d:41ddb95d",
    "315:5b24d1e6:b9306dfa",
    "275:ab23887d:ca232bb",
    "277:e003260c:28616e38",
  ],
  Media: [
    "275:8d4110a9:46b2d2ff",
    "303:c72cd43a:915b609c",
    "243:9fa056db:6d9b25bd",
    "277:2c1e776:3bcb1e7a",
    "221:829b7b2f:79ac319b",
    "259:dde564f6:c679118",
  ],
  Lawman: [
    "239:4a122e9f:7902969f",
    "267:4e85c8d2:a8389b1c",
    "243:a0d0c895:8fa135dd",
    "295:21716732:8d65cc7a",
    "305:5df4a565:f8ff5bbb",
    "289:2c802d58:a88c8e78",
  ],
  Exec: [
    "279:75fa5f29:4cf548ff",
    "285:210856b0:c79b327c",
    "229:aca122a7:69d1f2fd",
    "263:b0b73b88:12c407da",
    "305:e4c699b5:bd2626bb",
    "313:3d6a5ec6:90380398",
  ],
  Fixer: [
    "247:7f77219:5b7a9dbf",
    "237:979be39a:9b6c499c",
    "287:e0fa7567:3be715fd",
    "283:10d603b2:b10490ba",
    "303:6edd8509:f9bff37b",
    "287:f056290e:dcab8b58",
  ],
  Nomad: [
    "199:ba89e763:1c862fdf",
    "197:d2a23fa0:ea89483c",
    "217:98418019:2561e15d",
    "205:29f424dc:1beccd9a",
    "237:435570d7:20d0dadb",
    "249:fa49a002:cc642f18",
  ],
};

export async function updateHustleSummaries(
  table: FoundryRollTable,
  role: string,
  defaults: {
    results: {
      text: string;
      flags: Record<string, { hustle: { activity: string } }>;
    }[];
  },
): Promise<void> {
  if (table.getFlag(MODULE_ID, "hustleSummaryVersion") === 1) return;
  const updates: Record<string, unknown>[] = [];
  for (const result of table.results ?? []) {
    const stored = result.getFlag(MODULE_ID, "hustle") as
      { activity?: string; earnings?: number[]; roll?: number } | undefined;
    if (!stored || !Number.isInteger(stored.roll) || !result.id) continue;
    const index = stored.roll! - 1;
    const expected = LEGACY_ROWS[role]?.[index];
    if (!expected) continue;
    const fingerprint = rowFingerprint(
      JSON.stringify([
        result.text,
        stored.activity,
        stored.earnings,
        result.range,
        stored.roll,
      ]),
    );
    if (fingerprint !== expected) continue;
    const replacement = defaults.results[index]!;
    updates.push({
      _id: result.id,
      text: replacement.text,
      ["flags." + MODULE_ID + ".hustle.activity"]:
        replacement.flags[MODULE_ID]!.hustle.activity,
    });
  }
  if (updates.length)
    await table.updateEmbeddedDocuments("TableResult", updates);
  await table.update({ ["flags." + MODULE_ID + ".hustleSummaryVersion"]: 1 });
}

// Matching fingerprints only; works on HTTP-hosted Foundry without Web Crypto.
function rowFingerprint(value: string): string {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return (
    value.length + ":" + (a >>> 0).toString(16) + ":" + (b >>> 0).toString(16)
  );
}
