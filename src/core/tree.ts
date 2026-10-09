import { NodeStatus } from "./nodeDoc";

/** What the index knows about a node: frontmatter only, never the body. */
export interface NodeMeta {
  id: string;
  /** Vault path of the note. */
  path: string;
  /** Story folder this node belongs to. */
  story: string;
  parentId: string | null;
  regenOf: string | null;
  created: string;
  status: NodeStatus;
  starred: boolean;
  label: string;
  /** Title part of the file name (for pickers). */
  title: string;
  /** Model that produced the output (empty if unknown). */
  model: string;
}

export interface Position {
  index: number; // 1-based
  total: number;
}

const byCreated = (a: NodeMeta, b: NodeMeta): number =>
  a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * In-memory tree of one vault. Built from frontmatter, never written back.
 * Ids are unique per story, so nodes are keyed by `story + id`.
 */
export class TreeIndex {
  private nodes = new Map<string, NodeMeta>(); // key -> node
  private byPath = new Map<string, string>(); // path -> key
  private children = new Map<string, Set<string>>(); // parent key -> child keys

  private key(story: string, id: string): string {
    return `${story}\u0000${id}`;
  }

  get size(): number {
    return this.nodes.size;
  }

  clear(): void {
    this.nodes.clear();
    this.byPath.clear();
    this.children.clear();
  }

  upsert(meta: NodeMeta): void {
    this.removePath(meta.path);
    const k = this.key(meta.story, meta.id);
    const previous = this.nodes.get(k);
    if (previous) this.unlink(previous);
    this.nodes.set(k, meta);
    this.byPath.set(meta.path, k);
    if (meta.parentId) {
      const pk = this.key(meta.story, meta.parentId);
      let set = this.children.get(pk);
      if (!set) this.children.set(pk, (set = new Set()));
      set.add(k);
    }
  }

  removePath(path: string): void {
    const k = this.byPath.get(path);
    if (!k) return;
    const node = this.nodes.get(k);
    this.byPath.delete(path);
    if (node) {
      this.unlink(node);
      this.nodes.delete(k);
    }
  }

  renamePath(oldPath: string, newPath: string): void {
    const k = this.byPath.get(oldPath);
    if (!k) return;
    const node = this.nodes.get(k);
    if (!node) return;
    this.byPath.delete(oldPath);
    node.path = newPath;
    this.byPath.set(newPath, k);
  }

  private unlink(node: NodeMeta): void {
    if (!node.parentId) return;
    const pk = this.key(node.story, node.parentId);
    const set = this.children.get(pk);
    if (set) {
      set.delete(this.key(node.story, node.id));
      if (set.size === 0) this.children.delete(pk);
    }
  }

  hasId(story: string, id: string): boolean {
    return this.nodes.has(this.key(story, id));
  }

  get(story: string, id: string): NodeMeta | undefined {
    return this.nodes.get(this.key(story, id));
  }

  getByPath(path: string): NodeMeta | undefined {
    const k = this.byPath.get(path);
    return k ? this.nodes.get(k) : undefined;
  }

  parentOf(node: NodeMeta): NodeMeta | undefined {
    return node.parentId ? this.get(node.story, node.parentId) : undefined;
  }

  /** Children (next messages) of a node, oldest first. Pass null for story roots. */
  childrenOf(node: NodeMeta): NodeMeta[] {
    const set = this.children.get(this.key(node.story, node.id));
    if (!set) return [];
    return [...set].map((k) => this.nodes.get(k)!).sort(byCreated);
  }

  /** Starred nodes of a story. */
  starredIn(story: string): NodeMeta[] {
    const out: NodeMeta[] = [];
    for (const n of this.nodes.values()) if (n.story === story && n.starred) out.push(n);
    return out;
  }

  /** Nodes of a story that have no parent (normally just one). */
  rootsOf(story: string): NodeMeta[] {
    const out: NodeMeta[] = [];
    for (const n of this.nodes.values()) if (n.story === story && !n.parentId) out.push(n);
    return out.sort(byCreated);
  }

  /** Siblings under the same parent, including the node itself, oldest first. */
  private siblings(node: NodeMeta): NodeMeta[] {
    if (!node.parentId) return this.rootsOf(node.story);
    const parent = this.parentOf(node);
    if (parent) return this.childrenOf(parent);
    // Parent note missing: group by the dangling parent id.
    const set = this.children.get(this.key(node.story, node.parentId));
    return set ? [...set].map((k) => this.nodes.get(k)!).sort(byCreated) : [node];
  }

  /** The id of the original prompt version this node belongs to. */
  originalId(node: NodeMeta): string {
    return node.regenOf ?? node.id;
  }

  /** Prompt versions at this position: siblings without `regen_of`. */
  promptVersions(node: NodeMeta): NodeMeta[] {
    return this.siblings(node).filter((n) => !n.regenOf);
  }

  /** Original node plus all its regenerations, oldest first. */
  regenerations(node: NodeMeta): NodeMeta[] {
    const origId = this.originalId(node);
    return this.siblings(node).filter((n) => n.id === origId || n.regenOf === origId);
  }

  versionPosition(node: NodeMeta): Position {
    const list = this.promptVersions(node);
    const origId = this.originalId(node);
    const idx = list.findIndex((n) => n.id === origId);
    return { index: idx + 1, total: list.length };
  }

  regenPosition(node: NodeMeta): Position {
    const list = this.regenerations(node);
    return { index: list.findIndex((n) => n.id === node.id) + 1, total: list.length };
  }

  descendantCount(node: NodeMeta): number {
    let count = 0;
    const stack = this.childrenOf(node);
    while (stack.length) {
      const n = stack.pop()!;
      count++;
      stack.push(...this.childrenOf(n));
    }
    return count;
  }

  /** Root → node chain (inclusive). Stops safely on missing parents and cycles. */
  pathTo(node: NodeMeta): NodeMeta[] {
    const chain: NodeMeta[] = [];
    const seen = new Set<string>();
    let cur: NodeMeta | undefined = node;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = this.parentOf(cur);
    }
    return chain.reverse();
  }

  /** Navigate to the previous (-1) or next (+1) prompt version. */
  stepVersion(node: NodeMeta, dir: -1 | 1): NodeMeta | undefined {
    const list = this.promptVersions(node);
    const idx = list.findIndex((n) => n.id === this.originalId(node));
    const target = list[idx + dir];
    return target ? this.preferredMember(target) : undefined;
  }

  /** Navigate to the previous (-1) or next (+1) regeneration of the same prompt. */
  stepRegen(node: NodeMeta, dir: -1 | 1): NodeMeta | undefined {
    const list = this.regenerations(node);
    const idx = list.findIndex((n) => n.id === node.id);
    return list[idx + dir];
  }

  /**
   * Landing node when moving to a prompt version: the member (original or
   * regeneration) that has the biggest continuation, else the original.
   */
  preferredMember(original: NodeMeta): NodeMeta {
    const group = this.regenerations(original);
    let best = original;
    let bestCount = -1;
    for (const m of group) {
      const c = this.descendantCount(m);
      if (c > bestCount) {
        best = m;
        bestCount = c;
      }
    }
    return bestCount > 0 ? best : original;
  }
}
