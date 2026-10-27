import { App, FuzzyMatch, FuzzySuggestModal, Menu, Modal, Notice, Platform, Setting, setIcon } from "obsidian";
import { PROVIDER_LABEL, ProviderKind } from "../api/client";
import { chipModels, GenerationOverride, toggleFavorite } from "../core/modelChoice";
import type BranchingStoriesPlugin from "./main";

/** A prompt that can be dropped into the prompt window. */
export interface PromptChoice {
  /** Where it comes from, e.g. "Continues version 1". */
  label: string;
  text: string;
}

const snippet = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const DRAFT_PREFIX = "branching-stories:draft:";

/** Local-storage key under which an unsent prompt for this place in the story is kept. */
export function draftKey(story: string, nodeId: string | null, mode: "new" | "edit"): string {
  return `${DRAFT_PREFIX}${story}\u0000${nodeId ?? "root"}:${mode}`;
}

export function clearDraft(app: App, key: string | undefined): void {
  if (key) app.saveLocalStorage(key, null);
}

/**
 * Multi-line prompt entry. Resolves with the text, or null if closed without submitting.
 * With a `draftKey` what is typed is kept on this device while typing, so a window closed by
 * accident (a stray tap, the back gesture, an app switch) gets its text back next time.
 * The caller clears the draft once the prompt has really been used; the Cancel button discards it.
 */
export class PromptModal extends Modal {
  private result: string | null = null;
  private resolve!: (v: string | null) => void;
  private area: HTMLTextAreaElement | null = null;
  private discard = false;
  private saveTimer: number | null = null;

  constructor(
    app: App,
    private opts: {
      title: string;
      initial?: string;
      submitLabel: string;
      placeholder?: string;
      hint?: string;
      draftKey?: string;
      /** Prompts that can be reused (loaded after the window opens). */
      choices?: () => Promise<PromptChoice[]>;
      /** A prompt copied earlier with "Copy prompt of this node". */
      copied?: string | null;
      /** Shows the model chip and the thinking toggle, starting from these values. */
      generation?: { plugin: BranchingStoriesPlugin; provider: ProviderKind; model: string; reasoning: boolean };
    },
  ) {
    super(app);
    this.model = opts.generation?.model ?? "";
    this.thinking = opts.generation?.reasoning ?? false;
  }

  private model: string;
  private thinking: boolean;

  /** Model and thinking chosen in the window, for this generation only. */
  get override(): GenerationOverride<ProviderKind> | undefined {
    const g = this.opts.generation;
    return g ? { provider: g.provider, model: this.model, reasoning: this.thinking } : undefined;
  }

  /** The row above the text box: model chip (starred models first) and the thinking toggle. */
  private renderSettings(parent: HTMLElement): void {
    const g = this.opts.generation;
    if (!g) return;
    const row = parent.createDiv({ cls: "bs-gen-row" });

    const chip = row.createEl("button", { cls: "bs-chip bs-model-chip" });
    const paintChip = (): void => {
      chip.empty();
      chip.createSpan({ cls: "bs-chip-text", text: this.model || "No model selected" });
      setIcon(chip.createSpan({ cls: "bs-chip-icon" }), "chevron-down");
    };
    paintChip();
    chip.addEventListener("click", (ev) => {
      const menu = new Menu();
      for (const slug of chipModels(g.plugin.settings.favorites[g.provider], this.model)) {
        menu.addItem((item) =>
          item
            .setTitle(slug)
            .setChecked(slug === this.model)
            .onClick(() => {
              this.model = slug;
              paintChip();
            }),
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("More models…").setIcon("search").onClick(async () => {
          const picked = await pickModel(this.app, g.plugin, g.provider);
          if (picked) {
            this.model = picked;
            paintChip();
          }
        }),
      );
      menu.showAtMouseEvent(ev);
    });

    const think = row.createEl("button", { cls: "bs-chip bs-think-chip" });
    const paintThink = (): void => {
      think.empty();
      think.toggleClass("mod-cta", this.thinking);
      think.setAttr("aria-pressed", String(this.thinking));
      setIcon(think.createSpan({ cls: "bs-chip-icon" }), "brain");
      think.createSpan({ text: this.thinking ? "Thinking: on" : "Thinking: off" });
    };
    paintThink();
    think.addEventListener("click", () => {
      this.thinking = !this.thinking;
      paintThink();
    });
  }

  private saveDraft(): void {
    const key = this.opts.draftKey;
    if (!key || !this.area) return;
    const text = this.area.value;
    const unchanged = text.trim() === "" || text === (this.opts.initial ?? "");
    this.app.saveLocalStorage(key, unchanged ? null : text);
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

    const initial = this.opts.initial ?? "";
    const draft = this.opts.draftKey ? this.app.loadLocalStorage(this.opts.draftKey) : null;
    const restored = typeof draft === "string" && draft.trim() !== "" && draft !== initial;
    const restoredNote = restored ? contentEl.createDiv({ cls: "setting-item-description bs-draft-note" }) : null;

    this.renderSettings(contentEl);

    const reuseRow = this.opts.choices || this.opts.copied ? contentEl.createDiv({ cls: "bs-reuse" }) : null;

    const area = contentEl.createEl("textarea", { cls: "bs-prompt-input" });
    this.area = area;
    area.rows = Platform.isPhone ? 7 : 12; // leave room for the keyboard and the buttons
    area.placeholder = this.opts.placeholder ?? "";
    area.value = restored ? (draft as string) : initial;
    area.addEventListener("input", () => {
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.saveDraft(), 300);
    });

    // Replace the text with a reused prompt (and let the draft saver see the change).
    const fill = (text: string): void => {
      area.value = text;
      area.dispatchEvent(new Event("input"));
      area.focus();
      area.setSelectionRange(text.length, text.length);
    };
    if (reuseRow) {
      const copied = this.opts.copied?.trim();
      if (copied) {
        const b = reuseRow.createEl("button", { cls: "bs-reuse-btn", text: `Insert copied prompt: “${snippet(copied, 50)}”` });
        b.addEventListener("click", () => fill(copied));
      }
      this.opts.choices?.().then(
        (list) => {
          if (!this.area || !list.length) return; // closed meanwhile, or nothing to offer
          const first = list[0];
          const latest = reuseRow.createEl("button", {
            cls: "bs-reuse-btn",
            text: `Use the latest (${first.label.toLowerCase()}): “${snippet(first.text, 60)}”`,
          });
          latest.addEventListener("click", () => fill(first.text));
          if (list.length > 1) {
            const more = reuseRow.createEl("button", { cls: "bs-reuse-btn", text: `More prompts… (${list.length})` });
            more.addEventListener("click", async () => {
              const picked = await new ChoiceModal<PromptChoice>(
                this.app,
                list,
                (c) => `${c.label} — ${snippet(c.text, 90)}`,
                "Reuse a prompt",
              ).openAndWait();
              if (picked) fill(picked.text);
            });
          }
        },
        () => undefined, // a failed lookup must never block writing the prompt
      );
    }

    if (restoredNote) {
      restoredNote.createSpan({ text: "Restored your unsent draft. " });
      restoredNote.createEl("a", { text: "Discard it", href: "#" }).addEventListener("click", (ev) => {
        ev.preventDefault();
        area.value = initial;
        clearDraft(this.app, this.opts.draftKey);
        restoredNote.remove();
      });
    }

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
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          this.discard = true;
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText(this.opts.submitLabel).setCta().onClick(submit));
    if (!Platform.isMobile) contentEl.createEl("div", { text: "Ctrl+Enter to submit", cls: "setting-item-description" });
    window.setTimeout(() => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }, 0);
  }

  onClose(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.discard) clearDraft(this.app, this.opts.draftKey);
    else if (this.result === null) this.saveDraft(); // closed by accident: keep what was typed
    this.area = null;
    this.contentEl.empty();
    this.resolve(this.result);
  }
}

/** Single-line text entry. */
export class NameModal extends Modal {
  private result: string | null = null;
  private resolve!: (v: string | null) => void;

  constructor(
    app: App,
    private opts: { title: string; placeholder?: string; submitLabel: string; initial?: string; allowEmpty?: boolean },
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
    this.setTitle(this.opts.title);
    const input = contentEl.createEl("input", { type: "text", cls: "bs-name-input" });
    input.placeholder = this.opts.placeholder ?? "";
    input.value = this.opts.initial ?? "";
    const submit = (): void => {
      const v = input.value.trim();
      if (!v && !this.opts.allowEmpty) return;
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
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
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
          try {
            await navigator.clipboard.writeText(this.opts.body);
            new Notice("Copied.");
          } catch {
            new Notice("Could not copy; select the text and copy it by hand.");
          }
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
    /** Adds a star button to each row that toggles without choosing the row. */
    private star?: { isStarred: (item: T) => boolean; toggle: (item: T) => Promise<void> },
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    const star = this.star;
    if (!star) return;
    el.addClass("bs-star-row");
    const btn = el.createSpan({ cls: "bs-star-btn", attr: { "aria-label": "Star this model" } });
    const paint = (): void => {
      const on = star.isStarred(match.item);
      btn.toggleClass("is-starred", on);
      setIcon(btn, "star");
    };
    paint();
    const swallow = (ev: Event): void => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    btn.addEventListener("mousedown", swallow);
    btn.addEventListener("click", (ev) => {
      swallow(ev);
      star.toggle(match.item).then(paint, () => undefined);
    });
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

/** Progress with a cancel button, for long batches such as summaries. */
export class ProgressModal extends Modal {
  private bar!: HTMLProgressElement;
  private label!: HTMLElement;
  private finished = false;

  constructor(
    app: App,
    private opts: { title: string; total: number; onCancel: () => void },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle(this.opts.title);
    this.label = contentEl.createEl("p", { text: "Starting…" });
    this.bar = contentEl.createEl("progress");
    this.bar.max = this.opts.total;
    this.bar.value = 0;
    this.bar.addClass("bs-progress");
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Cancel").onClick(() => {
        this.opts.onCancel();
        this.close();
      }),
    );
  }

  update(done: number, label: string): void {
    if (this.finished) return;
    this.bar.value = done;
    this.label.setText(label);
  }

  finish(): void {
    this.finished = true;
    this.close();
  }

  onClose(): void {
    // Closing with Escape counts as cancel unless the work finished.
    if (!this.finished) {
      this.finished = true;
      this.opts.onCancel();
    }
    this.contentEl.empty();
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
  return new ChoiceModal<string>(app, items, (id) => id, `Search ${PROVIDER_LABEL[kind]} models`, {
    isStarred: (id) => plugin.settings.favorites[kind].includes(id),
    toggle: async (id) => {
      plugin.settings.favorites[kind] = toggleFavorite(plugin.settings.favorites[kind], id);
      await plugin.saveSettings();
    },
  }).openAndWait();
}
