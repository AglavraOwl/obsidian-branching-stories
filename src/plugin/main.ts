import { Notice, Plugin, SecretComponent, TFile, WorkspaceLeaf, normalizePath, requestUrl } from "obsidian";
import {
  ClientDeps,
  fetchModels,
  ModelInfo,
  PROVIDER_LABEL,
  ProviderConfig,
  ProviderKind,
} from "../api/client";
import { StoryOverrides } from "../core/storyDoc";
import { registerCommands } from "./commands";
import { EffectiveConfig, GenerationController } from "./generate";
import { BSSettings, BSSettingTab, mergeSettings } from "./settings";
import { HeaderActions } from "./headerActions";
import { navBarExtension, navBarPostProcessor, refreshNavBars } from "./navbar";
import { SIDEBAR_VIEW_TYPE, StorySidebar } from "./sidebar";
import { StoryStore } from "./store";
import { SummaryService } from "./summaries";

const LAST_ACTIVE_KEY = "branching-stories:last-active:";

export default class BranchingStoriesPlugin extends Plugin {
  settings!: BSSettings;
  store!: StoryStore;
  generation!: GenerationController;
  summaries!: SummaryService;
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

    this.addSettingTab(new BSSettingTab(this.app, this));
    registerCommands(this);

    this.statusEl = this.addStatusBarItem();
    this.store.onChange(() => {
      this.refreshStatusBar();
      this.scheduleUiRefresh();
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

  async activateSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
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

  providerConfig(kind: ProviderKind): ProviderConfig {
    return { kind, baseUrl: this.settings.providers[kind].baseUrl, apiKey: this.apiKey(kind) };
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
    if (meta.status === "generating") parts.push("generating…");
    else if (meta.status === "failed") parts.push("failed");
    else if (meta.status === "stopped") parts.push("stopped");
    this.statusEl.setText(parts.join(" · "));
  }

  notify(message: string): void {
    new Notice(message);
  }
}
