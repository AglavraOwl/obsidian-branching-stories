import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { NodeMeta } from "../core/tree";
import { nodeInfo, openNode } from "./actions";
import type BranchingStoriesPlugin from "./main";

export const SIDEBAR_VIEW_TYPE = "branching-stories-sidebar";

type Sort = "created" | "size";

export class StorySidebar extends ItemView {
  private storyFolder: string | null = null;
  private current: NodeMeta | null = null;
  private sort: Sort = "created";
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: BranchingStoriesPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Story";
  }

  getIcon(): string {
    return "git-branch";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("bs-sidebar");
    this.sort = this.plugin.settings.bookmarkSort;
    this.register(this.plugin.store.onChange(() => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.schedule()));
    this.update();
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.update();
    }, 150);
  }

  /** Follow the open note; keep the last story when a non-story note is open. */
  private update(): void {
    const file = this.app.workspace.getActiveFile();
    if (file) {
      const meta = this.plugin.store.nodeOf(file);
      if (meta) {
        this.storyFolder = meta.story;
        this.current = meta;
      } else if (this.plugin.store.isStoryRoot(file)) {
        this.storyFolder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
        this.current = null;
      }
    }
    // The remembered node may have been deleted or renamed away.
    if (this.current && !this.plugin.store.index.get(this.current.story, this.current.id)) this.current = null;
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    if (this.storyFolder === null) {
      el.createEl("p", { text: "Open a story note to see its path and bookmarks.", cls: "bs-empty" });
      return;
    }
    const idx = this.plugin.store.index;
    const storyName = this.storyFolder.split("/").pop() || "Story";
    el.createEl("h4", { text: storyName, cls: "bs-side-title" });

    // ---- path ---------------------------------------------------------------------
    el.createEl("div", { text: "Path", cls: "bs-side-heading" });
    const pathBox = el.createDiv({ cls: "bs-side-list" });
    if (this.current) {
      const path = idx.pathTo(this.current);
      path.forEach((meta, i) => this.row(pathBox, meta, { number: i + 1, current: meta.id === this.current!.id }));
      const children = idx.childrenOf(this.current);
      if (children.length) {
        el.createEl("div", { text: "Continues with", cls: "bs-side-heading" });
        const box = el.createDiv({ cls: "bs-side-list" });
        children.forEach((meta) => this.row(box, meta, {}));
      }
    } else {
      const roots = idx.rootsOf(this.storyFolder);
      if (!roots.length) pathBox.createEl("p", { text: "No nodes yet.", cls: "bs-empty" });
      else roots.forEach((meta) => this.row(pathBox, meta, {}));
    }

    // ---- bookmarks ------------------------------------------------------------------
    const head = el.createDiv({ cls: "bs-side-heading bs-side-heading-row" });
    head.createSpan({ text: "Bookmarks" });
    const sortBtn = head.createEl("button", {
      text: this.sort === "created" ? "Newest first" : "Largest first",
      cls: "bs-side-sort",
      attr: { title: "Change sort order" },
    });
    sortBtn.addEventListener("click", async () => {
      this.sort = this.sort === "created" ? "size" : "created";
      this.plugin.settings.bookmarkSort = this.sort;
      await this.plugin.saveSettings();
      this.render();
    });

    const starred = [...idx.starredIn(this.storyFolder)];
    const sizes = new Map(starred.map((m) => [m.id, idx.descendantCount(m)]));
    starred.sort((a, b) =>
      this.sort === "size"
        ? (sizes.get(b.id) ?? 0) - (sizes.get(a.id) ?? 0) || (a.created < b.created ? 1 : -1)
        : a.created < b.created
          ? 1
          : -1,
    );
    const box = el.createDiv({ cls: "bs-side-list" });
    if (!starred.length) box.createEl("p", { text: "Star a node to find it again here.", cls: "bs-empty" });
    for (const meta of starred) this.row(box, meta, { showBelow: true });
  }

  private row(parent: HTMLElement, meta: NodeMeta, opts: { number?: number; current?: boolean; showBelow?: boolean }): void {
    const info = nodeInfo(this.plugin, meta);
    const row = parent.createDiv({ cls: "bs-side-row" });
    if (opts.current) row.addClass("is-current");
    if (opts.number !== undefined) row.createSpan({ text: String(opts.number), cls: "bs-side-num" });
    if (meta.starred) setIcon(row.createSpan({ cls: "bs-side-star" }), "star");
    row.createSpan({ text: meta.label || meta.title, cls: "bs-side-name" });

    const badges = row.createSpan({ cls: "bs-side-badges" });
    if (info.version.total > 1 || opts.showBelow) badges.createSpan({ text: `v${info.version.index}/${info.version.total}`, cls: "bs-badge" });
    if (info.regen.total > 1) badges.createSpan({ text: `r${info.regen.index}/${info.regen.total}`, cls: "bs-badge" });
    if (opts.showBelow && info.descendants) badges.createSpan({ text: `${info.descendants} below`, cls: "bs-badge" });
    if (meta.status !== "done") badges.createSpan({ text: meta.status, cls: `bs-badge bs-status-${meta.status}` });

    row.addEventListener("click", () => {
      openNode(this.plugin, meta).catch((e) => this.plugin.generation.report(e));
    });
  }
}
