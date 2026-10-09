import { App, TFile, normalizePath, parseYaml } from "obsidian";
import { idFromBasename, idFromLink } from "../core/ids";
import { NodeFrontmatter, NodeSections, NodeStatus, parseNodeText, splitFrontmatter } from "../core/nodeDoc";
import { NODES_FOLDER, STORY_ROOT_FILE } from "../core/storyDoc";
import { NodeMeta, TreeIndex } from "../core/tree";

const STATUSES: NodeStatus[] = ["generating", "done", "failed", "stopped"];

/** Flatten `[["x"]]`-style arrays that YAML makes out of unquoted wikilinks. */
function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return null;
}

export interface LoadedNode {
  file: TFile;
  frontmatter: Record<string, unknown>;
  sections: NodeSections;
}

/** Keeps the tree index in sync with the vault and offers note-level reads. */
export class StoryStore {
  readonly index = new TreeIndex();
  private listeners = new Set<() => void>();

  constructor(private app: App) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- story folders --------------------------------------------------------

  /** Folder of the story that contains `path`, or null. */
  storyFolderOf(path: string): string | null {
    let dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    for (let guard = 0; guard < 20; guard++) {
      const root = normalizePath(dir ? `${dir}/${STORY_ROOT_FILE}` : STORY_ROOT_FILE);
      if (this.app.vault.getAbstractFileByPath(root)) return dir;
      if (!dir) return null;
      dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    }
    return null;
  }

  storyRootFile(storyFolder: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(`${storyFolder}/${STORY_ROOT_FILE}`));
    return f instanceof TFile ? f : null;
  }

  isStoryRoot(file: TFile): boolean {
    return file.name === STORY_ROOT_FILE;
  }

  nodesFolder(storyFolder: string): string {
    return normalizePath(`${storyFolder}/${NODES_FOLDER}`);
  }

  // ---- index maintenance ------------------------------------------------------

  metaFromFile(file: TFile): NodeMeta | null {
    if (file.extension !== "md" || file.name === STORY_ROOT_FILE) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    return this.metaFromFrontmatter(file, fm);
  }

  metaFromFrontmatter(file: TFile, fm: Record<string, unknown> | undefined): NodeMeta | null {
    if (!fm) return null;
    const id = typeof fm.id === "string" ? fm.id : null;
    if (!id || !("parent" in fm)) return null;
    if (idFromBasename(file.basename) !== id) return null; // not one of ours
    const story = this.storyFolderOf(file.path);
    if (story === null) return null;
    const parentRaw = firstString(fm.parent);
    const status = STATUSES.includes(fm.status as NodeStatus) ? (fm.status as NodeStatus) : "done";
    return {
      id,
      path: file.path,
      story,
      parentId: parentRaw ? idFromLink(parentRaw) : null,
      regenOf: firstString(fm.regen_of) ? idFromLink(firstString(fm.regen_of)) : null,
      created: typeof fm.created === "string" ? fm.created : String(fm.created ?? ""),
      status,
      starred: fm.starred === true,
      label: typeof fm.label === "string" ? fm.label : "",
      title: file.basename.slice(id.length).trim(),
    };
  }

  refreshFile(file: TFile): void {
    const meta = this.metaFromFile(file);
    if (meta) this.index.upsert(meta);
    else this.index.removePath(file.path);
    this.emit();
  }

  rebuild(): void {
    this.index.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const meta = this.metaFromFile(file);
      if (meta) this.index.upsert(meta);
    }
    this.emit();
  }

  removePath(path: string): void {
    this.index.removePath(path);
    this.emit();
  }

  /** Register a node we just created, without waiting for the metadata cache. */
  addMeta(meta: NodeMeta): void {
    this.index.upsert(meta);
    this.emit();
  }

  // ---- reading ------------------------------------------------------------------

  fileFor(meta: NodeMeta): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(meta.path);
    return f instanceof TFile ? f : null;
  }

  /** The node (if any) behind a file. */
  nodeOf(file: TFile | null): NodeMeta | undefined {
    return file ? this.index.getByPath(file.path) : undefined;
  }

  async load(file: TFile): Promise<LoadedNode> {
    const text = await this.app.vault.read(file);
    const { frontmatter: fmText } = splitFrontmatter(text);
    let frontmatter: Record<string, unknown> = {};
    if (fmText) {
      try {
        frontmatter = (parseYaml(fmText) as Record<string, unknown>) ?? {};
      } catch {
        frontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown>) ?? {};
      }
    }
    return { file, frontmatter, sections: parseNodeText(text).sections };
  }

  async loadMeta(meta: NodeMeta): Promise<LoadedNode | null> {
    const file = this.fileFor(meta);
    return file ? this.load(file) : null;
  }
}

export type { NodeFrontmatter };
