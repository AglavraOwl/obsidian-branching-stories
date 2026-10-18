import { NodeMeta, TreeIndex } from "./tree";

export type PromptOrigin =
  /** An existing child of the node the new prompt continues from. */
  | "continuation"
  /** A child of another version (or regeneration) of the node the new prompt continues from. */
  | "other-version"
  /** Another prompt version of the turn being edited. */
  | "version";

export interface PromptSource {
  /** The node whose prompt can be reused (always the original of its regeneration group). */
  node: NodeMeta;
  origin: PromptOrigin;
  /** For "other-version": which version of the parent turn this continuation belongs to (1-based). */
  fromVersion?: number;
}

const newestFirst = (a: PromptSource, b: PromptSource): number =>
  a.node.created < b.node.created ? 1 : a.node.created > b.node.created ? -1 : a.node.id < b.node.id ? 1 : -1;

/**
 * Prompts that can be reused when writing a new node under `parent` (null = the first node):
 * the continuations that already exist, and the continuations of the other versions of the
 * parent's turn. Regenerations share a prompt, so each prompt is listed once. Newest first.
 */
export function continuationSources(index: TreeIndex, story: string, parent: NodeMeta | null): PromptSource[] {
  const out: PromptSource[] = [];
  const seen = new Set<string>();
  const add = (n: NodeMeta, origin: PromptOrigin, fromVersion?: number): void => {
    const originalId = index.originalId(n);
    if (seen.has(originalId)) return;
    seen.add(originalId);
    out.push({ node: index.get(n.story, originalId) ?? n, origin, fromVersion });
  };

  const children = parent ? index.childrenOf(parent) : index.rootsOf(story);
  for (const c of children) add(c, "continuation");

  if (parent) {
    const ownOriginal = index.originalId(parent);
    for (const version of index.promptVersions(parent)) {
      if (version.id === ownOriginal) continue;
      const position = index.versionPosition(version).index;
      for (const member of index.regenerations(version)) {
        for (const c of index.childrenOf(member)) add(c, "other-version", position);
      }
    }
  }
  return out.sort(newestFirst);
}

/** Other prompt versions of the same turn (for editing a prompt). Newest first. */
export function versionSources(index: TreeIndex, node: NodeMeta): PromptSource[] {
  const ownOriginal = index.originalId(node);
  return index
    .promptVersions(node)
    .filter((v) => v.id !== ownOriginal)
    .map((v): PromptSource => ({ node: v, origin: "version", fromVersion: index.versionPosition(v).index }))
    .sort(newestFirst);
}

/** Drop sources whose prompt text is the same as one that is already listed (keeps the newest). */
export function dedupeByText<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
