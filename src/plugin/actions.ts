import { Notice, TFile, normalizePath } from "obsidian";
import { makeTimestamp, makeWikilink } from "../core/ids";
import { dedupeByText, PromptSource } from "../core/reuse";
import { compileOutputs } from "../core/summary";
import { NodeMeta } from "../core/tree";
import { emitYaml } from "../core/yaml";
import type BranchingStoriesPlugin from "./main";
import { ChoiceModal, NameModal, PromptChoice } from "./modals";

/** Everything the navigation bar, sidebar and commands show about a node's neighbours. */
export interface NodeInfo {
  version: { index: number; total: number };
  regen: { index: number; total: number };
  children: number;
  descendants: number;
  hasParent: boolean;
}

export function nodeInfo(plugin: BranchingStoriesPlugin, meta: NodeMeta): NodeInfo {
  const idx = plugin.store.index;
  return {
    version: idx.versionPosition(meta),
    regen: idx.regenPosition(meta),
    children: idx.childrenOf(meta).length,
    descendants: idx.descendantCount(meta),
    hasParent: !!meta.parentId,
  };
}

export function positionText(info: NodeInfo): string {
  return info.regen.total > 1
    ? `version ${info.version.index} of ${info.version.total}, regeneration ${info.regen.index} of ${info.regen.total}`
    : `version ${info.version.index} of ${info.version.total}`;
}

export async function openNode(plugin: BranchingStoriesPlugin, target: NodeMeta | TFile, newTab = false): Promise<void> {
  const file = target instanceof TFile ? target : plugin.store.fileFor(target);
  if (!file) {
    const where = target instanceof TFile ? target.path : `${target.path} (node ${target.id})`;
    console.error("[Branching Stories] note not found:", where);
    new Notice(`That note could not be found in the vault: ${where}. The plugin's list of nodes was refreshed; try again.`, 8000);
    plugin.store.rebuild();
    return;
  }
  await plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
}

export function describeNode(plugin: BranchingStoriesPlugin, meta: NodeMeta): string {
  const info = nodeInfo(plugin, meta);
  const parts = [`${meta.starred ? "★ " : ""}${meta.label || meta.title}`, `v${info.version.index}/${info.version.total}`];
  if (info.regen.total > 1) parts.push(`r${info.regen.index}/${info.regen.total}`);
  if (info.descendants) parts.push(`${info.descendants} below`);
  const status = plugin.statusOf(meta);
  if (status !== "done") parts.push(status);
  return parts.join(" · ");
}

async function choose(plugin: BranchingStoriesPlugin, nodes: NodeMeta[], placeholder: string): Promise<NodeMeta | null> {
  if (nodes.length === 1) return nodes[0];
  return new ChoiceModal<NodeMeta>(plugin.app, nodes, (n) => describeNode(plugin, n), placeholder).openAndWait();
}

// ---- navigation --------------------------------------------------------------------

export async function goUp(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const parent = plugin.store.index.parentOf(node);
  if (parent) return openNode(plugin, parent);
  const root = plugin.store.storyRootFile(node.story);
  if (root) return openNode(plugin, root);
}

/** Open a child of `node`, or a first node of the story when `node` is null. */
export async function goDown(plugin: BranchingStoriesPlugin, node: NodeMeta | null, storyFolder: string): Promise<void> {
  const idx = plugin.store.index;
  const children = node ? idx.childrenOf(node) : idx.rootsOf(storyFolder);
  if (!children.length) {
    new Notice('No children yet. Use "New node from here".');
    return;
  }
  const target = await choose(plugin, children, "Continue to…");
  if (target) await openNode(plugin, target);
}

export async function goStep(
  plugin: BranchingStoriesPlugin,
  node: NodeMeta,
  kind: "version" | "regen",
  dir: -1 | 1,
): Promise<void> {
  const idx = plugin.store.index;
  const target = kind === "version" ? idx.stepVersion(node, dir) : idx.stepRegen(node, dir);
  if (!target) {
    new Notice(`No ${dir < 0 ? "previous" : "next"} ${kind === "version" ? "prompt version" : "regeneration"}.`);
    return;
  }
  await openNode(plugin, target);
  new Notice(positionText(nodeInfo(plugin, target)), 2500);
}

export async function pickVersion(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const idx = plugin.store.index;
  const versions = idx.promptVersions(node).map((v) => idx.preferredMember(v));
  const target = await choose(plugin, versions, "Prompt versions of this turn");
  if (target) await openNode(plugin, target);
}

export async function pickRegen(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const list = plugin.store.index.regenerations(node);
  const target = await new ChoiceModal<NodeMeta>(
    plugin.app,
    list,
    (n) => {
      const pos = plugin.store.index.regenPosition(n);
      const when = n.created.replace("T", " ").slice(0, 16);
      return `r${pos.index}/${pos.total} · ${when}${n.model ? ` · ${n.model}` : ""}${n.status !== "done" ? ` · ${n.status}` : ""}`;
    },
    "Regenerations of this prompt",
  ).openAndWait();
  if (target) await openNode(plugin, target);
}

// ---- bookmarks ------------------------------------------------------------------------

export async function toggleStar(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const file = plugin.store.fileFor(node);
  if (!file) return;
  const starred = !node.starred;
  await plugin.app.fileManager.processFrontMatter(file, (fm) => {
    if (starred) fm.starred = true;
    else delete fm.starred;
  });
  plugin.store.addMeta({ ...node, starred });
  new Notice(starred ? "Starred." : "Star removed.", 1500);
}

export async function setLabel(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const file = plugin.store.fileFor(node);
  if (!file) return;
  const label = await new NameModal(plugin.app, {
    title: "Branch label",
    placeholder: node.label || "e.g. Koss recovers",
    submitLabel: "Save",
    initial: node.label,
    allowEmpty: true,
  }).open();
  if (label === null) return;
  await plugin.app.fileManager.processFrontMatter(file, (fm) => {
    if (label) fm.label = label;
    else delete fm.label;
  });
  plugin.store.addMeta({ ...node, label });
}

// ---- compile --------------------------------------------------------------------------

/** Write the Output sections along the path to a new note. */
export async function compilePath(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const store = plugin.store;
  const path = store.index.pathTo(node);
  const outputs: string[] = [];
  for (const meta of path) {
    const loaded = await store.loadMeta(meta);
    if (loaded) outputs.push(loaded.sections.output);
  }
  const text = compileOutputs(outputs);
  if (!text) {
    new Notice("There is no output on this path to compile.");
    return;
  }

  const storyName = node.story.split("/").pop() || "Story";
  const stamp = makeTimestamp(new Date()).replace(/[-:]/g, "").replace("T", "-").slice(2, 13);
  const folder = normalizePath(`${node.story}/Compiled`);
  await plugin.ensureFolder(folder);
  const nodeFile = store.fileFor(node);
  const name = `${storyName} ${stamp} ${(node.label || node.title).replace(/[\\/:*?"<>|#^[\]]/g, " ").trim()}`.trim();
  const fm = emitYaml({
    compiled: makeTimestamp(new Date()),
    story: storyName,
    ends_at: nodeFile ? makeWikilink(nodeFile.basename) : undefined,
    nodes: outputs.filter((o) => o.trim()).length,
  });
  const file = await plugin.app.vault.create(normalizePath(`${folder}/${name}.md`), `---\n${fm}\n---\n\n${text}\n`);
  await plugin.app.workspace.getLeaf(false).openFile(file);
  new Notice(`Compiled ${outputs.filter((o) => o.trim()).length} turns.`);
}

// ---- prompts: copy, reuse, open elsewhere --------------------------------------------

/** Put the node's prompt on the clipboard and remember it for the prompt window. */
export async function copyPrompt(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const file = plugin.store.fileFor(node);
  if (!file) return;
  const text = (await plugin.store.load(file)).sections.prompt.trim();
  if (!text) {
    new Notice("This node has no prompt text.");
    return;
  }
  plugin.setCopiedPrompt(text);
  try {
    await navigator.clipboard.writeText(text);
    new Notice("Prompt copied.");
  } catch {
    new Notice('Prompt remembered; use "Insert copied prompt" in the prompt window (the system clipboard was not available).');
  }
}

const MAX_REUSE_CHOICES = 40;

/** Read the prompts behind the sources, for the "reuse a prompt" list. */
export async function promptChoices(plugin: BranchingStoriesPlugin, sources: PromptSource[]): Promise<PromptChoice[]> {
  const idx = plugin.store.index;
  const loaded: PromptChoice[] = [];
  for (const source of sources.slice(0, MAX_REUSE_CHOICES)) {
    const node = await plugin.store.loadMeta(source.node);
    const text = node?.sections.prompt.trim();
    if (!text) continue;
    const pos = idx.versionPosition(source.node);
    const label =
      source.origin === "continuation"
        ? `Existing continuation (v${pos.index}/${pos.total})`
        : source.origin === "other-version"
          ? `Continues version ${source.fromVersion}`
          : `Version ${source.fromVersion} of this turn`;
    loaded.push({ label, text });
  }
  return dedupeByText(loaded);
}

/** Pick a neighbouring node (parent, children, other versions or regenerations) and open it in a new tab. */
export async function openNeighbourInNewTab(plugin: BranchingStoriesPlugin, node: NodeMeta | null, storyFolder: string): Promise<void> {
  const idx = plugin.store.index;
  const items: { label: string; meta: NodeMeta }[] = [];
  const seen = new Set<string>();
  const add = (prefix: string, meta: NodeMeta | undefined): void => {
    if (!meta || seen.has(meta.id) || meta.id === node?.id) return;
    seen.add(meta.id);
    items.push({ label: `${prefix} · ${describeNode(plugin, meta)}`, meta });
  };

  if (node) {
    add("Parent", idx.parentOf(node));
    for (const c of idx.childrenOf(node)) add("Child", c);
    const own = idx.originalId(node);
    for (const v of idx.promptVersions(node)) if (v.id !== own) add("Other version", idx.preferredMember(v));
    for (const r of idx.regenerations(node)) add("Regeneration", r);
  } else {
    for (const r of idx.rootsOf(storyFolder)) add("First node", r);
  }
  if (!items.length) {
    new Notice("No neighbouring nodes to open.");
    return;
  }
  const chosen = await new ChoiceModal<{ label: string; meta: NodeMeta }>(
    plugin.app,
    items,
    (i) => i.label,
    "Open in a new tab…",
  ).openAndWait();
  if (chosen) await openNode(plugin, chosen.meta, true);
}
