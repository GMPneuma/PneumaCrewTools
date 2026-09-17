/** Minimal globals used by this starter. Add full Foundry typings as the module grows. */
declare const foundry: {
  utils: {
    randomID(length?: number): string;
  };
};

declare const Hooks: {
  on(
    event: "preUpdateSetting",
    callback: (
      setting: { key: string },
      changes: { value?: unknown },
    ) => boolean | void,
  ): number;
  on(
    event: "simple-calendar-date-time-change" | "simple-calendar-ready",
    callback: () => void,
  ): number;
  on(
    event: "createChatMessage" | "updateChatMessage" | "deleteChatMessage",
    callback: (message: FoundryChatMessage) => void,
  ): number;
  on(
    event: "createJournalEntry" | "updateJournalEntry" | "deleteJournalEntry",
    callback: (journal: FoundryJournalEntry) => void,
  ): number;
  on(event: "createActor", callback: (actor: FoundryActor) => void): number;
  on(
    event: "createItem" | "updateItem" | "deleteItem",
    callback: (item: FoundryItem) => void,
  ): number;
  on(
    event: "updateActor",
    callback: (actor: FoundryActor, changes: Record<string, unknown>) => void,
  ): number;
  on(
    event: "createJournalEntryPage" | "deleteJournalEntryPage",
    callback: (page: FoundryJournalPage) => void,
  ): number;
  on(
    event: "renderSettingsConfig",
    callback: (app: unknown, html: FoundryHtml | HTMLElement) => void,
  ): number;
  on(
    event: "updateWorldTime",
    callback: (
      time: number,
      delta: number,
      options: Record<string, unknown>,
      userId: string,
    ) => void,
  ): number;
  on(
    event:
      | "createJournalEntry"
      | "updateJournalEntry"
      | "deleteJournalEntry"
      | "deleteJournalEntryPage"
      | "updateSetting"
      | "createItem"
      | "updateItem"
      | "deleteItem"
      | "deleteActor"
      | "updateActor"
      | "updateUser"
      | "deleteUser"
      | "userConnected",
    callback: () => void,
  ): number;
  on(
    event: "getSceneControlButtons",
    callback: (controls: SceneControl[]) => void,
  ): number;
  on(event: "deleteActor", callback: (actor: FoundryActor) => void): number;
  on(
    event: "updateCompendium",
    callback: (pack: { collection: string }) => void,
  ): number;
  on(
    event: "createJournalEntryPage",
    callback: (
      page: FoundryJournalPage,
      options: Record<string, unknown>,
      userId: string,
    ) => void,
  ): number;
  once(event: "init" | "ready", callback: () => void | Promise<void>): number;
  on(
    event: "renderChatMessage",
    callback: (message: FoundryChatMessage, html: FoundryHtml) => void,
  ): number;
  on(
    event: "updateJournalEntryPage",
    callback: (
      page: FoundryJournalPage,
      changes: Record<string, unknown>,
      options: Record<string, unknown>,
      userId: string,
    ) => void,
  ): number;
};

interface ApplicationOptions {
  id?: string;
  classes?: string[];
  title?: string;
  template?: string;
  width?: number;
  height?: number | "auto";
  resizable?: boolean;
  scrollY?: string[];
  closeOnSubmit?: boolean;
  submitOnChange?: boolean;
}

interface FoundryHtml {
  0?: HTMLElement;
}

interface ApplicationPosition {
  left?: number;
  top?: number;
  width?: number;
  height?: number | string;
  scale?: number;
}

declare abstract class FormApplication {
  static get defaultOptions(): ApplicationOptions;
  readonly rendered: boolean;
  setPosition(position?: ApplicationPosition): ApplicationPosition | void;
  render(force?: boolean, options?: { focus?: boolean }): this;
  close(): Promise<void>;
  getData(): object;
  activateListeners(html: FoundryHtml): void;
  close(): Promise<void>;
  protected _onSubmit(
    event: Event,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  protected _render(
    force: boolean,
    options?: Record<string, unknown>,
  ): Promise<void>;
  protected abstract _updateObject(
    event: Event,
    formData: Record<string, unknown>,
  ): Promise<void>;
}

interface SceneControlTool {
  name: string;
  title: string;
  icon: string;
  button: boolean;
  visible: boolean;
  onClick: () => void;
}

interface SceneControl {
  name: string;
  tools: SceneControlTool[];
}

interface FoundrySettingConfig {
  // Native select settings map stored values to their display labels.
  choices?: Record<string, string>;
  onChange?: (value: unknown) => void;
  name: string;
  hint?: string;
  scope: "client" | "world";
  config: boolean;
  type:
    | ObjectConstructor
    | StringConstructor
    | BooleanConstructor
    | ArrayConstructor
    | NumberConstructor;
  default: object | string | boolean | number;
  range?: { min: number; max: number; step: number };
}

interface FoundrySettingsMenuConfig {
  name: string;
  label: string;
  hint?: string;
  icon?: string;
  type: typeof FormApplication;
  restricted?: boolean;
}

interface FoundryModule {
  active: boolean;
  api?: unknown;
}

interface FoundryActor {
  img?: string;
  ownership?: Record<string, number>;
  documentName?: string;
  folder?: FoundryFolder | null;
  delete(): Promise<unknown>;
  items?: Iterable<FoundryItem>;
  uuid: string;
  id: string;
  name: string;
  type: string;
  system: unknown;
  sheet?: {
    render(force?: boolean): unknown;
    _onRoll?(event: MouseEvent): Promise<unknown>;
    showLedger?(
      property: "wealth" | "improvementPoints" | "reputation",
    ): Promise<unknown>;
  };
  testUserPermission(
    user: FoundryUser,
    permission: "OWNER" | "OBSERVER",
  ): boolean;
  update(data: Record<string, unknown>): Promise<unknown>;
  createEmbeddedDocuments(
    type: "Item",
    data: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ): Promise<FoundryItem[]>;
  deleteEmbeddedDocuments(
    type: "Item",
    ids: string[],
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  getFlag(namespace: string, key: string): unknown;
}

interface FoundryItem {
  snort?(): Promise<unknown>;
  uuid?: string;
  pack?: string;
  parent?: FoundryActor;
  sheet?: { render(force?: boolean): unknown };
  update?(data: Record<string, unknown>): Promise<unknown>;
  testUserPermission?(
    user: FoundryUser,
    permission: "OWNER" | "OBSERVER",
  ): boolean;
  toCompendium?(pack: unknown): Record<string, unknown>;
  recursiveGetAllInstalledItems?(): FoundryItem[];
  uninstall?(options: { skipDialog: boolean }): Promise<unknown>;
  createRoll?(
    type: string,
    actor: FoundryActor,
    extraData?: Record<string, unknown>,
  ): {
    // Native CPR roll modifiers can be filtered before and after its dialog.
    mods?: { value: number; source: string; id?: string }[];
    addMod(mods: { value: number; source: string }[]): void;
    handleRollDialog(
      event: { type: string; ctrlKey: boolean; metaKey: boolean },
      actor: FoundryActor,
      item: FoundryItem,
    ): Promise<boolean>;
    roll(): Promise<unknown>;
    resultTotal: number;
  };
  system?: unknown;
  id: string;
  name: string;
  type: string;
  img?: string;
  documentName?: string;
  toObject(): Record<string, unknown>;
}

declare function fromUuid(uuid: string): Promise<unknown>;

interface FoundryUser {
  id: string;
  name: string;
  isGM: boolean;
  active: boolean;
  character: FoundryActor | null;
  getFlag(namespace: string, key: string): unknown;
  update(data: Record<string, unknown>): Promise<unknown>;
}

declare const game: {
  i18n: { localize(key: string): string };
  items?: Iterable<FoundryItem>;
  packs?: Iterable<{
    documentName: string;
    collection: string;
    getDocuments(): Promise<FoundryItem[]>;
  }>;
  tables: Iterable<FoundryRollTable>;
  folders: Iterable<FoundryFolder>;
  time: {
    worldTime: number;
    calendar?: import("./calendar-date").NativeCalendar;
    advance(
      seconds: number,
      options?: Record<string, unknown>,
    ): Promise<number>;
    set?(seconds: number, options?: Record<string, unknown>): Promise<number>;
  };
  user: FoundryUser | null;
  users: Iterable<FoundryUser>;
  actors: Iterable<FoundryActor> & {
    get(id: string): FoundryActor | undefined;
  };
  modules: Map<string, FoundryModule>;
  settings: {
    register(
      namespace: string,
      key: string,
      config: FoundrySettingConfig,
    ): void;
    registerMenu(
      namespace: string,
      key: string,
      config: FoundrySettingsMenuConfig,
    ): void;
    get(namespace: string, key: string): unknown;
    set(namespace: string, key: string, value: unknown): Promise<unknown>;
  };
  journal: Iterable<FoundryJournalEntry> & {
    get(id: string): FoundryJournalEntry | undefined;
  };
  messages: Iterable<FoundryChatMessage>;
};

declare const ui: {
  // Native v12 scene-control refresh used by personal shortcut preferences.
  controls?: { initialize(): void };
  windows?: Record<
    string,
    {
      rendered: boolean;
      options?: ApplicationOptions;
      render(force?: boolean): unknown;
    }
  >;
  notifications: {
    warn(message: string): void;
    info(message: string): void;
    error(message: string): void;
  };
};

declare class Roll {
  static validate(formula: string): boolean;
  constructor(formula: string);
  total: number;
  evaluate(options?: {
    minimize?: boolean;
    maximize?: boolean;
    allowInteractive?: boolean;
  }): Promise<Roll>;
}

interface FoundryChatMessage {
  author?: FoundryUser;
  getFlag(namespace: string, key: string): unknown;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

declare const ChatMessage: {
  create(data: Record<string, unknown>): Promise<FoundryChatMessage>;
};

interface DialogButtonConfig {
  icon?: string;
  label: string;
  callback?: (html: FoundryHtml) => void;
}

declare class Dialog {
  element: FoundryHtml;
  close(): Promise<void>;
  submit(button: DialogButtonConfig): Promise<void>;
  constructor(
    config: {
      title: string;
      content: string;
      buttons: Record<string, DialogButtonConfig>;
      default?: string;
      render?: (html: FoundryHtml) => void;
      close?: () => void;
    },
    options?: ApplicationOptions,
  );
  setPosition(position?: ApplicationPosition): ApplicationPosition | void;
  render(force?: boolean): this;
}

interface FoundryJournalPage {
  ownership?: Record<string, number>;
  testUserPermission?(user: FoundryUser, permission: string): boolean;
  parent?: FoundryJournalEntry;
  _stats?: { createdBy?: string; lastModifiedBy?: string };
  getFlag?(namespace: string, key: string): unknown;
  id: string;
  name: string;
  text?: { content?: string };
  update(data: Record<string, unknown>): Promise<unknown>;
}

interface FoundryJournalEntry {
  folder?: FoundryFolder | null;
  delete(): Promise<unknown>;
  ownership?: Record<string, number>;
  sheet?: { render(force?: boolean, options?: { pageId?: string }): unknown };
  getFlag?(namespace: string, key: string): unknown;
  id: string;
  name: string;
  pages: Iterable<FoundryJournalPage>;
  update(data: Record<string, unknown>): Promise<unknown>;
  createEmbeddedDocuments(
    type: "JournalEntryPage",
    data: object[],
    options?: Record<string, unknown>,
  ): Promise<FoundryJournalPage[]>;
  deleteEmbeddedDocuments(
    type: "JournalEntryPage",
    ids: string[],
  ): Promise<unknown>;
}

declare const JournalEntry: {
  create(data: Record<string, unknown>): Promise<FoundryJournalEntry>;
};

interface FoundryFolder {
  id: string;
  name: string;
  type: string;
  folder: FoundryFolder | null;
}
declare const Folder: {
  create(data: Record<string, unknown>): Promise<FoundryFolder>;
};

declare const Actor: {
  create(data: Record<string, unknown>): Promise<FoundryActor>;
};

interface FoundryTableResult {
  range?: [number, number];
  id: string;
  text?: string;
  weight?: number;
  drawn?: boolean;
  getFlag(namespace: string, key: string): unknown;
}
interface FoundryRollTable {
  updateEmbeddedDocuments(
    type: "TableResult",
    updates: Record<string, unknown>[],
  ): Promise<unknown>;
  formula?: string;
  results?: Iterable<FoundryTableResult>;
  name: string;
  testUserPermission?(user: FoundryUser, permission: string): boolean;
  img?: string;
  id: string;
  description: string;
  update(data: Record<string, unknown>): Promise<unknown>;
  roll(options?: { recursive?: boolean }): Promise<{
    roll: { total: number };
    results: {
      id: string;
      text?: string;
      getFlag(namespace: string, key: string): unknown;
    }[];
  }>;
  getFlag(namespace: string, key: string): unknown;
}
declare const RollTable: {
  create(data: Record<string, unknown>): Promise<FoundryRollTable>;
};

declare const Item: { deleteDocuments(ids: string[]): Promise<unknown> };
