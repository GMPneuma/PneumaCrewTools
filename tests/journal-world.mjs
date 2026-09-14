// Minimal native-document fixture shared by Journal storage integration tests.
export function journalWorld(game) {
  let id = 0;
  const collection = () => {
    const c = new Map();
    c[Symbol.iterator] = function* () {
      yield* this.values();
    };
    return c;
  };
  game.journal = collection();
  game.folders = [];
  if (Array.isArray(game.actors))
    game.actors.get = (key) => game.actors.find((a) => a.id === key);
  const canWrite = (j) => game.user?.isGM || j.ownership?.[game.user?.id] === 3;
  const update = (target, data) => {
    for (const [key, value] of Object.entries(data)) {
      const path = key.split(".");
      let node = target;
      for (const part of path.slice(0, -1)) node = node[part] ??= {};
      node[path.at(-1)] = structuredClone(value);
    }
  };
  const makePage = (data, j) => ({
    ...structuredClone(data),
    id: "page" + ++id,
    getFlag(ns, key) {
      return this.flags?.[ns]?.[key];
    },
    testUserPermission(user, permission) {
      const level =
        this.ownership?.[user.id] ??
        this.ownership?.default ??
        j.ownership?.[user.id] ??
        j.ownership?.default ??
        0;
      return user.isGM || level >= (permission === "OWNER" ? 3 : 2);
    },
    async update(data) {
      if (!this.testUserPermission(game.user, "OWNER"))
        throw Error("Journal permission denied");
      update(this, data);
    },
  });
  const JournalEntry = {
    async create(data) {
      if (!game.user?.isGM) throw Error("Only GM can create Journal");
      const j = {
        ...structuredClone(data),
        id: "journal" + ++id,
        getFlag(ns, key) {
          return this.flags?.[ns]?.[key];
        },
        async update(data) {
          if (!canWrite(j)) throw Error("Journal permission denied");
          update(this, data);
        },
        async createEmbeddedDocuments(_type, rows) {
          if (!canWrite(j)) throw Error("Journal permission denied");
          const pages = rows.map((r) => makePage(r, j));
          j.pages.push(...pages);
          return pages;
        },
        async deleteEmbeddedDocuments(_type, ids) {
          if (!canWrite(j)) throw Error("Journal permission denied");
          j.pages = j.pages.filter((p) => !ids.includes(p.id));
        },
      };
      j.pages = (data.pages ?? []).map((r) => makePage(r, j));
      game.journal.set(j.id, j);
      return j;
    },
  };
  const Folder = {
    async create(data) {
      const f = { ...data, id: "folder" + ++id };
      game.folders.push(f);
      return f;
    },
  };
  return { JournalEntry, Folder };
}
