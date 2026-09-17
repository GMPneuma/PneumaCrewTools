import {
  moduleFlags,
  type ModuleBackup,
  type JsonObject,
} from "./module-data-model";

export interface DataNode {
  id: string;
  name: string;
  type: string;
  location: string;
  note: string;
  fields: string;
  references: string[];
  children: DataNode[];
  rows: any[];
  uuid?: string;
  missing?: boolean;
  missingUserId?: string;
  stalePermissions?: number;
  journalId?: string;
  pageId?: string;
  count: number;
  bytes: number;
}

// Only persisted Crew Tools data is traversed. Native document contents and
// other modules' flags are not recursively treated as Crew Tools references.
export function buildCleanupTree(
  backup: ModuleBackup,
  rows: any[],
  world: any,
): DataNode[] {
  const nodes = new Map<string, DataNode>();
  const documents = new Map<
    string,
    { raw: JsonObject; parent?: string; type: string; name: string }
  >();
  const roots = new Map<string, DataNode>();
  const rootNames: Record<string, string> = {
    JournalEntry: "Journals",
    Actor: "Actors",
    Item: "World Items",
    RollTable: "RollTables",
    ChatMessage: "Chat messages",
    User: "Users",
    Setting: "Settings · static configuration",
    Compendium: "Compendium references",
    Scene: "Scenes",
    Macro: "Macros",
    Playlist: "Playlists",
    Cards: "Cards",
    Folder: "Folders",
  };
  const make = (id: string, name: string, type: string): DataNode => ({
    id,
    name,
    type,
    location: id,
    note: "",
    fields: "",
    references: [],
    children: [],
    rows: [],
    count: 0,
    bytes: 0,
  });
  const root = (type: string) => {
    const key = rootNames[type] ? type : "Folder";
    if (!roots.has(key))
      roots.set(key, make("group:" + key, rootNames[key]!, ""));
    return roots.get(key)!;
  };
  const index = (type: string, doc: any, parent?: string) => {
    const raw = doc._source ?? doc.raw ?? (doc.toObject ? doc.toObject() : doc);
    const id = doc.id ?? raw._id;
    if (!id) return;
    const uuid = parent ? `${parent}.${type}.${id}` : `${type}.${id}`;
    documents.set(uuid, {
      raw,
      parent,
      type,
      name:
        doc.name ??
        raw.name ??
        (type === "ChatMessage" ? `Chat message ${id}` : id),
    });
    for (const [property, childType] of [
      ["pages", "JournalEntryPage"],
      ["items", "Item"],
      ["results", "TableResult"],
    ])
      for (const child of doc[property!] ?? raw[property!] ?? [])
        index(childType!, child, uuid);
  };
  for (const [collection, type] of [
    ["folders", "Folder"],
    ["journal", "JournalEntry"],
    ["actors", "Actor"],
    ["items", "Item"],
    ["tables", "RollTable"],
    ["messages", "ChatMessage"],
    ["users", "User"],
    ["scenes", "Scene"],
    ["macros", "Macro"],
    ["playlists", "Playlist"],
    ["cards", "Cards"],
  ])
    for (const doc of world[collection!] ?? []) index(type!, doc);
  // Backup data supplies names and pages in reduced test environments too.
  for (const entry of backup.entries) {
    if (entry.kind === "setting") continue;
    const type = {
      journal: "JournalEntry",
      actor: "Actor",
      item: "Item",
      table: "RollTable",
      folder: "Folder",
    }[entry.kind];
    const uuid = entry.parentId
      ? `Actor.${entry.parentId}.${type}.${entry.id}`
      : `${type}.${entry.id}`;
    if (!documents.has(uuid))
      index(
        type,
        { ...entry.data, _id: entry.id, name: entry.name },
        entry.parentId ? `Actor.${entry.parentId}` : undefined,
      );
  }
  const ensure = (uuid: string): DataNode => {
    const existing = nodes.get(uuid);
    if (existing) return existing;
    const parts = uuid.split(".");
    const embedded = parts[0] !== "Compendium" && parts.length === 4;
    const doc = documents.get(uuid),
      type = doc?.type ?? (embedded ? parts[2]! : parts[0]!);
    const node = make(uuid, doc?.name ?? uuid, type);
    nodes.set(uuid, node); // Register before attaching parents, including damaged folder cycles.
    node.uuid = uuid;
    node.missing = !doc && type !== "Compendium";
    if (node.missing && type === "User") node.missingUserId = parts[1];
    node.note = doc
      ? "Referenced by Crew Tools; no disposable module history on this object."
      : type === "Compendium"
        ? "Saved compendium reference. Availability is checked when opened."
        : "Referenced object is no longer present in this world.";
    if (doc && type === "Actor")
      node.note =
        "Native character resources and inventory. Cleanup does not reset these values.";
    let parent: DataNode;
    if (doc?.parent || embedded)
      parent = ensure(doc?.parent ?? parts.slice(0, 2).join("."));
    else if (doc?.raw.folder && documents.has("Folder." + doc.raw.folder))
      parent = ensure("Folder." + doc.raw.folder);
    else if (type === "Folder") parent = root(doc?.raw.type ?? "Folder");
    else parent = root(type);
    // Avoid cyclic nesting if a damaged folder points back into its own subtree.
    const contains = (n: DataNode): boolean =>
      n === parent || n.children.some(contains);
    if (parent === node || contains(node)) parent = root(type);
    parent.children.push(node);
    if (type === "JournalEntry") node.journalId = uuid.split(".")[1];
    if (type === "JournalEntryPage") {
      node.journalId = uuid.split(".")[1];
      node.pageId = uuid.split(".")[3];
    }
    return node;
  };
  const ref = (uuid: string, origin: DataNode) => {
    const node = ensure(uuid);
    const label = `${origin.name} (${origin.id})`;
    if (node !== origin && !node.references.includes(label))
      node.references.push(label);
  };
  const uuidPattern =
    /^(?:Actor|Item|JournalEntry|RollTable|ChatMessage|User|Folder|Scene|Macro|Playlist|Cards|Compendium)\.[A-Za-z0-9_.-]+$/;
  const scan = (
    value: any,
    origin: DataNode,
    actorId = "",
    tableId = "",
    key = "",
    parent: any = {},
  ) => {
    if (typeof value === "string") {
      if (uuidPattern.test(value)) ref(value, origin);
      for (const match of value.matchAll(/@UUID\[([^\]]+)\]/g))
        if (uuidPattern.test(match[1]!)) ref(match[1]!, origin);
      if (!value || value.includes(".") || /\s/.test(value)) return;
      let type = "";
      if (
        /actorIds?$/i.test(key) ||
        [
          "sourceId",
          "targetId",
          "upgradeProjectsFor",
          "actorExclusions",
          "payoutContainerActor",
          "defaultPayoutContainerId",
          "hqId",
        ].includes(key)
      )
        type = "Actor";
      else if (/userIds?$/i.test(key)) type = "User";
      else if (/journalId$/i.test(key)) type = "JournalEntry";
      else if (/tableId$/i.test(key)) type = "RollTable";
      else if (/folderId$/i.test(key)) type = "Folder";
      else if (/messageId$/i.test(key)) type = "ChatMessage";
      else if (/itemId$/i.test(key) || key === "skillId") {
        const owner = key === "storageItemId" ? parent.storageActorId : actorId;
        if (owner) ref(`Actor.${owner}.Item.${value}`, origin);
        return;
      } else if (key === "resultId" && tableId) {
        ref(`RollTable.${tableId}.TableResult.${value}`, origin);
        return;
      }
      if (type) ref(`${type}.${value}`, origin);
    } else if (Array.isArray(value))
      value.forEach((v) => scan(v, origin, actorId, tableId, key, parent));
    else if (value && typeof value === "object") {
      if (key === "discordLinks")
        for (const id of Object.keys(value)) {
          if (id !== "__everyone__") ref("Actor." + id, origin);
        }
      const owner = value.sourceId ?? value.actorId ?? actorId;
      for (const [k, v] of Object.entries(value)) {
        if (k === "ownership" && v && typeof v === "object") {
          for (const id of Object.keys(v))
            if (id !== "default") ref("User." + id, origin);
        } else scan(v, origin, owner, value.tableId ?? tableId, k, value);
      }
    }
  };
  const owned = (uuid: string, raw: JsonObject) => {
    const node = ensure(uuid),
      flags = moduleFlags(raw);
    node.fields = Object.keys(flags).join(", ");
    node.note = node.fields
      ? "Crew Tools stores data in this object's module flags."
      : "Content of a Crew Tools document.";
    if (node.type === "JournalEntry")
      node.note =
        "Crew Tools Journal. Expand its pages to inspect the stored records and cleanup options.";
    if (node.type === "JournalEntryPage")
      node.note = "Saved records and readable Journal page text.";
    if (node.type === "RollTable" && flags.hustleRole)
      node.note =
        "Module-maintained Hustle table · static reference content. Excluded from history totals and cleanup.";
    if (node.type === "ChatMessage")
      node.note =
        "Crew Tools chat card. Settled pharmaceutical cards are removed with their transfer history; there is no independent chat purge.";
    const owner =
      flags.actorId ?? (uuid.startsWith("Actor.") ? uuid.split(".")[1] : "");
    scan(flags, node, owner);
    if (raw.ownership)
      for (const id of Object.keys(raw.ownership))
        if (id !== "default") {
          ref("User." + id, node);
          const user = ensure("User." + id);
          if (user.missing)
            user.stalePermissions = (user.stalePermissions ?? 0) + 1;
        }
    if (node.type === "JournalEntryPage") scan(raw.text?.content, node, owner);
    return node;
  };
  for (const [uuid, doc] of documents) {
    const parentOwned =
      doc.parent &&
      Object.keys(moduleFlags(documents.get(doc.parent)?.raw ?? {})).length;
    if (
      Object.keys(moduleFlags(doc.raw)).length ||
      (parentOwned && ["JournalEntryPage", "TableResult"].includes(doc.type))
    ) {
      const node = owned(uuid, doc.raw);
      // Parent ownership supplies the character for page-local embedded Item IDs.
      if (doc.parent)
        scan(
          moduleFlags(doc.raw),
          node,
          moduleFlags(documents.get(doc.parent)?.raw ?? {}).actorId,
        );
    }
  }
  for (const entry of backup.entries.filter((e) => e.kind === "setting")) {
    const id = `Setting.${entry.id}`,
      node = make(id, entry.name, "World setting");
    node.location = `Module Settings → Crew Tools → ${entry.name} (${entry.id})`;
    node.note =
      "Static configuration. Does not accumulate history through play.";
    node.fields = entry.id;
    nodes.set(id, node);
    root("Setting").children.push(node);
    scan(entry.data.value, node, "", "", entry.id);
  }
  // Client settings are stored separately for this browser/user, not in the world export.
  for (const config of world.settings?.settings?.values?.() ?? []) {
    if (config.namespace !== "pneuma-crewtools" || config.scope !== "client")
      continue;
    const node = make(
      `ClientSetting.${config.key}`,
      config.name ?? config.key,
      "Client setting",
    );
    node.location = `This browser / user → Crew Tools → ${config.key}`;
    node.note =
      "Static preference for this browser. Excluded from world record totals and export.";
    nodes.set(node.id, node);
    root("Setting").children.push(node);
    scan(
      world.settings.get(config.namespace, config.key),
      node,
      "",
      "",
      config.key,
    );
  }
  for (const row of rows) {
    if (row.id === "chat") {
      const group = root("ChatMessage");
      group.rows.push(row);
      group.count += row.count;
      group.bytes += row.bytes;
      continue;
    } // Show each actual message, not a duplicate aggregate object.
    let uuid: string;
    if (row.journalId)
      uuid =
        `JournalEntry.${row.journalId}` +
        (row.pageId ? `.JournalEntryPage.${row.pageId}` : "");
    else {
      const [kind, parent, id] = row.id.split(":");
      uuid =
        kind === "setting"
          ? `Setting.${id}`
          : kind === "actor"
            ? `Actor.${id}`
            : parent
              ? `Actor.${parent}.Item.${id}`
              : `Item.${id}`;
    }
    const node = nodes.get(uuid) ?? ensure(uuid);
    node.rows.push(row);
    node.count += row.count;
    node.bytes += row.bytes;
  }
  const finish = (node: DataNode, path: string[]) => {
    if (
      !node.id.startsWith("Setting.") &&
      !node.id.startsWith("ClientSetting.")
    )
      node.location = [...path, node.name].join(" → ");
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) {
      finish(child, [...path, node.name]);
      node.count += child.count;
      node.bytes += child.bytes;
    }
  };
  const result = Object.keys(rootNames).flatMap((key) =>
    roots.has(key) ? [roots.get(key)!] : [],
  );
  for (const n of result) finish(n, []);
  return result;
}
