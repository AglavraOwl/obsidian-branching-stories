import { Notice, Plugin, SecretComponent, TFile, normalizePath, requestUrl } from "obsidian";
import {
  ClientDeps,
  fetchModels,
  ModelInfo,
  PROVIDER_LABEL,
  ProviderConfig,
  ProviderKind,
} from "../api/client";
import { displayStatus, DisplayStatus } from "../core/status";
import { StoryOverrides } from "../core/storyDoc";
import { NodeMeta } from "../core/tree";
import { registerCommands } from "./commands";
import { saveFragment, SelectionTracker } from "./fragments";
import { EffectiveConfig, GenerationController } from "./generate";
import { BSSettings, BSSettingTab, mergeSettings } from "./settings";
import { HeaderActions } from "./headerActions";
import { navBarExtension, navBarPostProcessor, refreshNavBars } from "./navbar";
import { SIDEBAR_VIEW_TYPE, StorySidebar } from "./sidebar";
import { StoryStore } from "./store";
import { SummaryService } from "./summaries";

const LAST_ACTIVE_KEY = "branching-stories:last-active:";
const BASE_URL_KEY = "branching-stories:base-url:";
const RUNNING_KEY = "branching-stories:running";
const COPIED_PROMPT_KEY = "branching-stories:copied-prompt";

export default class BranchingStoriesPlugin extends Plugin {
  settings!: BSSettings;
  store!: StoryStore;
  generation!: GenerationController;
  summaries!: SummaryService;
  selection!: SelectionTracker;
  private headerActions!: HeaderActions;
  private uiTimer: number | null = null;
  private statusEl: HTMLElement | null = null;

  readonly clientDeps: ClientDeps = {
    fetch: (input, init) => window.fetch(input, init),
    request: async (o) => {
      const res = await requestUrl({
        url: o.url,
        method: o.method,
        headers: o.headers,
        body: o.body,
        contentType: o.headers["Content-Type"],
        throw: false,
      });
      return { status: res.status, text: res.text };
    },
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new StoryStore(this.app);
    this.generation = new GenerationController(this);
    this.summaries = new SummaryService(this);
    this.headerActions = new HeaderActions(this);
    this.selection = new SelectionTracker(this);
    this.selection.start();

    this.addSettingTab(new BSSettingTab(this.app, this));
    registerCommands(this);

    // Right-click (and, where Obsidian offers it, long-press) menu of the editor.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const node = info.file ? this.store.nodeOf(info.file) : undefined;
        const selected = editor.getSelection();
        if (!node || !selected.trim()) return;
        menu.addItem((item) =>
          item
            .setTitle("Save as fragment")
            .setIcon("text-quote")
            .onClick(() => void saveFragment(this, node, selected).catch((e) => this.generation.report(e))),
        );
      }),
    );

    this.statusEl = this.addStatusBarItem();
    this.store.onChange(() => {
      this.refreshStatusBar();
      this.scheduleUiRefresh();
    });

    // Header buttons and reading-view bars outlive the plugin unless removed (disable, update, reload).
    this.register(() => {
      this.headerActions.destroy();
      document.querySelectorAll(".bs-navbar").forEach((el) => el.remove());
    });

    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new StorySidebar(leaf, this));
    this.addRibbonIcon("git-branch", "Story sidebar", () => void this.activateSidebar());
    this.registerEditorExtension(navBarExtension(this));
    this.registerMarkdownPostProcessor(navBarPostProcessor(this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.headerActions.syncAll()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.headerActions.syncAll()));

    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.store.refreshFile(file)));
    this.registerEvent(this.app.metadataCache.on("deleted", (file) => this.store.removePath(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        this.store.removePath(oldPath);
        this.store.refreshFile(file);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.rememberActive(file);
        this.refreshStatusBar();
        this.headerActions.syncAll();
      }),
    );

    let rebuiltOnResolve = false;
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (rebuiltOnResolve) return;
        rebuiltOnResolve = true;
        this.store.rebuild();
        void this.generation.failStale();
      }),
    );
    this.app.workspace.onLayoutReady(() => {
      this.store.rebuild();
      void this.generation.failStale();
      this.refreshStatusBar();
      this.headerActions.syncAll();
    });
  }

  /** Redraw navigation bars and header buttons after the tree changed (debounced). */
  private scheduleUiRefresh(): void {
    if (this.uiTimer !== null) return;
    this.uiTimer = window.setTimeout(() => {
      this.uiTimer = null;
      refreshNavBars(this);
      this.headerActions.syncAll();
    }, 120);
  }

  /** When a menu, ribbon or command last opened something: taps right after it are ignored (see below). */
  private transitionAt = 0;

  markTransition(): void {
    this.transitionAt = Date.now();
  }

  /**
   * On a touch screen the end of the tap that picked a menu item can land on whatever appears under
   * the finger a moment later (a sidebar row, a navigation button). Such taps are ignored.
   */
  inTransition(): boolean {
    return Date.now() - this.transitionAt < 700;
  }

  async activateSidebar(): Promise<void> {
    this.markTransition();
    const { workspace } = this.app;
    try {
      const existing = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
      // A panel left over from before an update or reload belongs to the old plugin and stays blank:
      // keep only one that is really ours.
      const ours = existing.find((l) => l.view instanceof StorySidebar) ?? null;
      for (const l of existing) if (l !== ours) l.detach();

      let leaf = ours;
      if (!leaf) {
        leaf = workspace.getRightLeaf(false);
        if (!leaf) throw new Error("Could not create a panel in the right sidebar.");
        await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      if (!(leaf.view instanceof StorySidebar)) {
        throw new Error(`The story sidebar did not load (panel type "${leaf.view?.getViewType?.() ?? "unknown"}").`);
      }
    } catch (e) {
      this.generation.report(e);
    }
  }

  /** What the plugin currently knows, for the connection test. */
  indexSummary(): string {
    const index = this.store.index;
    const stories = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const meta = index.getByPath(file.path);
      if (meta) stories.add(meta.story);
    }
    const panels = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE).length;
    return `${index.size} nodes in ${stories.size} stories · sidebar panels: ${panels}`;
  }

  // ---- settings -------------------------------------------------------------------

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  hasSecretStorage(): boolean {
    return typeof SecretComponent === "function" && !!(this.app as unknown as { secretStorage?: unknown }).secretStorage;
  }

  private apiKey(kind: ProviderKind): string {
    if (kind !== "openrouter") return "";
    const cfg = this.settings.providers.openrouter;
    if (this.hasSecretStorage()) {
      const storage = (this.app as unknown as { secretStorage: { getSecret(id: string): string | null } }).secretStorage;
      return (cfg.keySecretName && storage.getSecret(cfg.keySecretName)) || "";
    }
    return cfg.keyPlain;
  }

  /**
   * LM Studio runs on one machine, so its address differs per device (localhost on the PC, the PC's
   * network address on a phone). That address is kept in this device's local storage and never
   * synced; the value in the settings file is only the default.
   */
  baseUrl(kind: ProviderKind): string {
    if (kind === "lmstudio") {
      const local = this.app.loadLocalStorage(BASE_URL_KEY + kind);
      if (typeof local === "string" && local.trim()) return local.trim();
    }
    return this.settings.providers[kind].baseUrl;
  }

  setLocalBaseUrl(kind: ProviderKind, value: string): void {
    this.app.saveLocalStorage(BASE_URL_KEY + kind, value.trim() || null);
  }

  hasLocalBaseUrl(kind: ProviderKind): boolean {
    const local = this.app.loadLocalStorage(BASE_URL_KEY + kind);
    return typeof local === "string" && !!local.trim();
  }

  providerConfig(kind: ProviderKind): ProviderConfig {
    return { kind, baseUrl: this.baseUrl(kind), apiKey: this.apiKey(kind) };
  }

  // ---- copied prompt (kept on this device) -------------------------------------------

  copiedPrompt(): string | null {
    const v = this.app.loadLocalStorage(COPIED_PROMPT_KEY);
    return typeof v === "string" && v.trim() ? v : null;
  }

  setCopiedPrompt(text: string): void {
    this.app.saveLocalStorage(COPIED_PROMPT_KEY, text);
  }

  // ---- generations started on this device -------------------------------------------

  private runningSet(): Set<string> {
    const v = this.app.loadLocalStorage(RUNNING_KEY);
    return new Set(Array.isArray(v) ? (v as string[]) : []);
  }

  private runningKey(meta: NodeMeta): string {
    return `${meta.story}\u0000${meta.id}`;
  }

  markRunning(meta: NodeMeta, running: boolean): void {
    const set = this.runningSet();
    if (running) set.add(this.runningKey(meta));
    else set.delete(this.runningKey(meta));
    this.app.saveLocalStorage(RUNNING_KEY, set.size ? [...set] : null);
  }

  /** Started on this device and not finished: it was interrupted if no request is running now. */
  startedHere(meta: NodeMeta): boolean {
    return this.runningSet().has(this.runningKey(meta));
  }

  statusOf(meta: NodeMeta): DisplayStatus {
    return displayStatus(meta.status, meta.created, Date.now(), this.generation.isGenerating(meta));
  }

  /** Global settings with the story's root-note overrides applied. */
  effectiveConfig(o: StoryOverrides): EffectiveConfig {
    const g = this.settings.generation;
    const provider: ProviderKind = o.provider === "lmstudio" || o.provider === "openrouter" ? o.provider : g.provider;
    // A model slug belongs to one provider: do not reuse the default one for another.
    const model = o.model ?? (provider === g.provider ? g.model : "");
    return {
      provider,
      model,
      temperature: o.temperature ?? g.temperature,
      maxTokens: o.maxTokens ?? g.maxTokens,
      topP: o.topP ?? g.topP,
      reasoning: g.reasoning,
      recentTurns: o.recentTurns ?? this.settings.recentTurns,
    };
  }

  // ---- models ---------------------------------------------------------------------

  async refreshModels(kind: ProviderKind): Promise<ModelInfo[]> {
    const models = await fetchModels(this.providerConfig(kind), this.clientDeps);
    this.settings.modelCache[kind] = { fetchedAt: Date.now(), models };
    await this.saveSettings();
    return models;
  }

  /** Throws a clear error when the slug is empty or unknown to the provider. */
  async ensureModel(kind: ProviderKind, slug: string): Promise<void> {
    const label = PROVIDER_LABEL[kind];
    if (!slug) throw new Error(`No model selected for ${label}. Choose one in the plugin settings.`);
    if (this.settings.modelCache[kind].models.some((m) => m.id === slug)) return;
    // Not in the cached list: refresh once in case the list is stale.
    const models = await this.refreshModels(kind);
    if (models.some((m) => m.id === slug)) return;
    const tail = slug.toLowerCase().split("/").pop()!.slice(0, 8);
    const near = models.filter((m) => m.id.toLowerCase().includes(tail)).slice(0, 5).map((m) => m.id);
    throw new Error(
      `Model "${slug}" is not in the ${label} model list (${models.length} models, fetched just now).` +
        (near.length ? ` Similar: ${near.join(", ")}.` : "") +
        ` Check the slug in the plugin settings or use "Choose…".`,
    );
  }

  // ---- story helpers -------------------------------------------------------------

  async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private rememberActive(file: TFile | null): void {
    const meta = this.store.nodeOf(file);
    if (meta) this.app.saveLocalStorage(LAST_ACTIVE_KEY + meta.story, meta.id);
  }

  lastActiveId(storyFolder: string): string | null {
    const v = this.app.loadLocalStorage(LAST_ACTIVE_KEY + storyFolder);
    return typeof v === "string" ? v : null;
  }

  refreshStatusBar(): void {
    if (!this.statusEl) return;
    const file = this.app.workspace.getActiveFile();
    const meta = this.store?.nodeOf(file);
    if (!meta) {
      this.statusEl.setText(this.generation?.activeCount ? "Generating…" : "");
      return;
    }
    const idx = this.store.index;
    const v = idx.versionPosition(meta);
    const r = idx.regenPosition(meta);
    const depth = idx.pathTo(meta).length;
    const parts = [`v ${v.index}/${v.total}`];
    if (r.total > 1) parts.push(`r ${r.index}/${r.total}`);
    parts.push(`depth ${depth}`);
    const status = this.statusOf(meta);
    if (status === "generating") parts.push("generating…");
    else if (status !== "done") parts.push(status);
    this.statusEl.setText(parts.join(" · "));
  }

  notify(message: string): void {
    new Notice(message);
  }
}
