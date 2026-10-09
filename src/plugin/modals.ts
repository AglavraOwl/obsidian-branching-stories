import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import { PROVIDER_LABEL, ProviderKind } from "../api/client";
import type BranchingStoriesPlugin from "./main";

/** Multi-line prompt entry. Resolves with the text, or null if cancelled. */
export class PromptModal extends Modal {
  private result: string | null = null;
  private resolve!: (v: string | null) => void;

  constructor(
    app: App,
    private opts: { title: string; initial?: string; submitLabel: string; placeholder?: string; hint?: string },
  ) {
    super(app);
  }

  open(): Promise<string | null> {
    const p = new Promise<string | null>((res) => (this.resolve = res));
    super.open();
    return p;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bs-prompt-modal");
    this.setTitle(this.opts.title);
    if (this.opts.hint) contentEl.createEl("p", { text: this.opts.hint, cls: "setting-item-description" });

    const area = contentEl.createEl("textarea", { cls: "bs-prompt-input" });
    area.rows = 12;
    area.placeholder = this.opts.placeholder ?? "";
    area.value = this.opts.initial ?? "";

    const submit = (): void => {
      const text = area.value.trim();
      if (!text) {
        new Notice("The prompt is empty.");
        return;
      }
      this.result = text;
      this.close();
    };
    area.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.opts.submitLabel).setCta().onClick(submit));
    contentEl.createEl("div", { text: "Ctrl+Enter to submit", cls: "setting-item-description" });
    window.setTimeout(() => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.result);
  }
}

/** Single-line text entry. */
export class NameModal extends Modal {
  private result: string | null = null;
  private resolve!: (v: string | null) => void;

  constructor(app: App, private opts: { title: string; placeholder?: string; submitLabel: string }) {
    super(app);
  }

  open(): Promise<string | null> {
    const p = new Promise<string | null>((res) => (this.resolve = res));
    super.open();
    return p;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle(this.opts.title);
    const input = contentEl.createEl("input", { type: "text", cls: "bs-name-input" });
    input.placeholder = this.opts.placeholder ?? "";
    const submit = (): void => {
      const v = input.value.trim();
      if (!v) return;
      this.result = v;
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.opts.submitLabel).setCta().onClick(submit));
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.result);
  }
}

export class ConfirmModal extends Modal {
  private result = false;
  private resolve!: (v: boolean) => void;

  constructor(app: App, private opts: { title: string; body: string; confirmLabel: string }) {
    super(app);
  }

  open(): Promise<boolean> {
    const p = new Promise<boolean>((res) => (this.resolve = res));
    super.open();
    return p;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle(this.opts.title);
    contentEl.createEl("pre", { text: this.opts.body, cls: "bs-pre" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.opts.confirmLabel)
          .setCta()
          .onClick(() => {
            this.result = true;
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.result);
  }
}

/** Read-only text viewer (context preview). */
export class TextViewModal extends Modal {
  constructor(app: App, private opts: { title: string; summary: string; body: string }) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("bs-wide-modal");
    this.setTitle(this.opts.title);
    contentEl.createEl("pre", { text: this.opts.summary, cls: "bs-pre" });
    contentEl.createEl("pre", { text: this.opts.body, cls: "bs-pre bs-pre-scroll" });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Copy").onClick(async () => {
          await navigator.clipboard.writeText(this.opts.body);
          new Notice("Copied.");
        }),
      )
      .addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Generic one-of-many picker. */
export class ChoiceModal<T> extends FuzzySuggestModal<T> {
  private chosen: T | null = null;
  private resolve!: (v: T | null) => void;

  constructor(
    app: App,
    private items: T[],
    private labelOf: (item: T) => string,
    placeholder: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  openAndWait(): Promise<T | null> {
    const p = new Promise<T | null>((res) => (this.resolve = res));
    this.open();
    return p;
  }

  getItems(): T[] {
    return this.items;
  }

  getItemText(item: T): string {
    return this.labelOf(item);
  }

  onChooseItem(item: T): void {
    this.chosen = item;
  }

  onClose(): void {
    super.onClose();
    // onChooseItem runs after onClose; resolve on the next tick.
    window.setTimeout(() => this.resolve(this.chosen), 0);
  }
}

/** Pick a model slug from the cached list, favorites first. */
export async function pickModel(app: App, plugin: BranchingStoriesPlugin, kind: ProviderKind): Promise<string | null> {
  const cache = plugin.settings.modelCache[kind];
  if (!cache.models.length) {
    try {
      await plugin.refreshModels(kind);
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e), 10000);
      return null;
    }
  }
  const favorites = plugin.settings.favorites[kind];
  const ids = plugin.settings.modelCache[kind].models.map((m) => m.id);
  const items = [...favorites.filter((f) => ids.includes(f)), ...ids.filter((id) => !favorites.includes(id))];
  if (!items.length) {
    new Notice(`${PROVIDER_LABEL[kind]} returned no models.`);
    return null;
  }
  return new ChoiceModal<string>(
    app,
    items,
    (id) => (favorites.includes(id) ? `★ ${id}` : id),
    `Search ${PROVIDER_LABEL[kind]} models`,
  ).openAndWait();
}
