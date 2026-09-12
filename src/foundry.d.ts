/** Minimal globals used by this starter. Add full Foundry typings as the module grows. */
declare const foundry: {
  utils: {
    randomID(length?: number): string;
  };
};

declare const Hooks: {
  on(
    event: "renderSettingsConfig",
    callback: (app: unknown, html: FoundryHtml) => void,
  ): number;
  on(
    event: "getSceneControlButtons",
    callback: (controls: SceneControl[]) => void,
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
  closeOnSubmit?: boolean;
  submitOnChange?: boolean;
}

interface FoundryHtml {
  0?: HTMLElement;
}

declare abstract class FormApplication {
  static get defaultOptions(): ApplicationOptions;
  readonly rendered: boolean;
  render(force?: boolean): this;
  close(): Promise<void>;
  getData(): object;
  activateListeners(html: FoundryHtml): void;
  close(): Promise<void>;
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
  name: string;
  hint?: string;
  scope: "client" | "world";
  config: boolean;
  type: ObjectConstructor | StringConstructor | BooleanConstructor;
  default: object | string | boolean;
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
  version?: string;
  active: boolean;
  api?: unknown;
}

interface FoundryActor {
  uuid: string;
  id: string;
  name: string;
  type: string;
  system: unknown;
  sheet?: { render(force?: boolean): unknown };
  testUserPermission(user: FoundryUser, permission: "OWNER"): boolean;
  update(data: Record<string, unknown>): Promise<unknown>;
  createEmbeddedDocuments(
    type: "Item",
    data: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ): Promise<FoundryItem[]>;
  deleteEmbeddedDocuments(type: "Item", ids: string[]): Promise<unknown>;
  getFlag(namespace: string, key: string): unknown;
}

interface FoundryItem {
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
  notifications: {
    warn(message: string): void;
    info(message: string): void;
    error(message: string): void;
  };
};

declare class Roll {
  constructor(formula: string);
  total: number;
  evaluate(): Promise<Roll>;
}

interface FoundryChatMessage {
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
  constructor(config: {
    title: string;
    content: string;
    buttons: Record<string, DialogButtonConfig>;
    default?: string;
    close?: () => void;
  });
  render(force?: boolean): this;
}

interface FoundryJournalPage {
  id: string;
  name: string;
  text?: { content?: string };
  update(data: Record<string, unknown>): Promise<unknown>;
}

interface FoundryJournalEntry {
  isOwner: boolean;
  getFlag(namespace: string, key: string): unknown;
  id: string;
  name: string;
  pages: Iterable<FoundryJournalPage>;
  update(data: Record<string, unknown>): Promise<unknown>;
  createEmbeddedDocuments(
    type: "JournalEntryPage",
    data: object[],
  ): Promise<FoundryJournalPage[]>;
  deleteEmbeddedDocuments(
    type: "JournalEntryPage",
    ids: string[],
  ): Promise<unknown>;
}

declare const JournalEntry: {
  create(data: Record<string, unknown>): Promise<FoundryJournalEntry>;
};
