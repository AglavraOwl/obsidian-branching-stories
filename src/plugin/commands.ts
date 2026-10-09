import { Notice, TFile, normalizePath } from "obsidian";
import { PROVIDER_LABEL } from "../api/client";
import { NODES_FOLDER, newStoryNote, STORY_ROOT_FILE } from "../core/storyDoc";
import { NodeMeta } from "../core/tree";
import { ChoiceModal, NameModal, PromptModal, TextViewModal } from "./modals";
import type BranchingStoriesPlugin from "./main";

interface Where {
  storyFolder: string;
  /** The open node, or undefined when the open note is the story root. */
  node?: NodeMeta;
  file: TFile;
}

function whereAmI(plugin: BranchingStoriesPlugin): Where | null {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) return null;
  if (plugin.store.isStoryRoot(file)) {
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    return { storyFolder: folder, file };
  }
  const node = plugin.store.nodeOf(file);
  return node ? { storyFolder: node.story, node, file } : null;
}

async function open(plugin: BranchingStoriesPlugin, meta: NodeMeta | TFile): Promise<void> {
  const file = meta instanceof TFile ? meta : plugin.store.fileFor(meta);
  if (!file) {
    new Notice("That note could not be found in the vault.");
    return;
  }
  await plugin.app.workspace.getLeaf(false).openFile(file);
}

function positionText(plugin: BranchingStoriesPlugin, meta: NodeMeta): string {
  const idx = plugin.store.index;
  const v = idx.versionPosition(meta);
  const r = idx.regenPosition(meta);
  return r.total > 1 ? `version ${v.index} of ${v.total}, regeneration ${r.index} of ${r.total}` : `version ${v.index} of ${v.total}`;
}

function describeChild(plugin: BranchingStoriesPlugin, meta: NodeMeta): string {
  const idx = plugin.store.index;
  const v = idx.versionPosition(meta);
  const r = idx.regenPosition(meta);
  const below = idx.descendantCount(meta);
  const parts = [`${meta.starred ? "★ " : ""}${meta.label || meta.title}`, `v${v.index}/${v.total}`];
  if (r.total > 1) parts.push(`r${r.index}/${r.total}`);
  if (below) parts.push(`${below} below`);
  if (meta.status !== "done") parts.push(meta.status);
  return parts.join(" · ");
}

async function chooseNode(plugin: BranchingStoriesPlugin, nodes: NodeMeta[], placeholder: string): Promise<NodeMeta | null> {
  if (nodes.length === 1) return nodes[0];
  return new ChoiceModal<NodeMeta>(plugin.app, nodes, (n) => describeChild(plugin, n), placeholder).openAndWait();
}

export function registerCommands(plugin: BranchingStoriesPlugin): void {
  const { app } = plugin;

  const add = (
    id: string,
    name: string,
    available: (w: Where) => boolean,
    run: (w: Where) => Promise<void>,
  ): void => {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const w = whereAmI(plugin);
        if (!w || !available(w)) return false;
        if (!checking) {
          run(w).catch((e) => plugin.generation.report(e));
        }
        return true;
      },
    });
  };

  // ---- story ----------------------------------------------------------------------
  plugin.addCommand({
    id: "new-story",
    name: "New story",
    callback: async () => {
      const name = await new NameModal(app, { title: "New story", placeholder: "Story name", submitLabel: "Create" }).open();
      if (!name) return;
      const safe = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
      if (!safe) return;
      const folder = normalizePath(`${plugin.settings.storiesRoot}/${safe}`);
      if (app.vault.getAbstractFileByPath(folder)) {
        new Notice(`"${folder}" already exists.`);
        return;
      }
      await plugin.ensureFolder(folder);
      await plugin.ensureFolder(`${folder}/${NODES_FOLDER}`);
      const file = await app.vault.create(normalizePath(`${folder}/${STORY_ROOT_FILE}`), newStoryNote(safe));
      await app.workspace.getLeaf(false).openFile(file);
      new Notice("Story created. Edit the system prompt and lore, then run \"New node from here\".");
    },
  });

  // ---- generation -----------------------------------------------------------------
  add("new-node", "New node from here", () => true, async (w) => {
    const prompt = await new PromptModal(app, {
      title: w.node ? "Next prompt" : "First prompt",
      submitLabel: "Generate",
      placeholder: "What happens next? You can link notes with [[Note name]] to include them.",
    }).open();
    if (!prompt) return;
    await plugin.generation.run({ storyFolder: w.storyFolder, parent: w.node ?? null, prompt, regenOf: null });
  });

  add("regenerate", "Regenerate", (w) => !!w.node, async (w) => {
    const node = w.node!;
    if (plugin.generation.isGenerating(node)) {
      new Notice("This node is still generating.");
      return;
    }
    const loaded = await plugin.store.load(w.file);
    if (!loaded.sections.prompt.trim()) {
      new Notice("This node has no prompt text to regenerate.");
      return;
    }
    await plugin.generation.run({
      storyFolder: node.story,
      parent: plugin.store.index.parentOf(node) ?? null,
      prompt: loaded.sections.prompt,
      regenOf: plugin.store.index.originalId(node),
      keep: loaded.sections.keep,
    });
  });

  add("edit-regenerate", "Edit prompt and regenerate", (w) => !!w.node, async (w) => {
    const node = w.node!;
    const loaded = await plugin.store.load(w.file);
    const prompt = await new PromptModal(app, {
      title: "Edit prompt (creates a new version)",
      initial: loaded.sections.prompt,
      submitLabel: "Generate",
    }).open();
    if (!prompt) return;
    await plugin.generation.run({
      storyFolder: node.story,
      parent: plugin.store.index.parentOf(node) ?? null,
      prompt,
      regenOf: null,
      keep: loaded.sections.keep,
    });
  });

  plugin.addCommand({
    id: "stop-generation",
    name: "Stop generation",
    checkCallback: (checking) => {
      if (!plugin.generation.activeCount) return false;
      if (!checking) {
        const w = whereAmI(plugin);
        const stopped = (w?.node && plugin.generation.stop(w.node)) || plugin.generation.stop();
        if (!stopped) new Notice("Several generations are running; open the one to stop.");
      }
      return true;
    },
  });

  // ---- navigation -------------------------------------------------------------------
  add("go-up", "Go to parent node", () => true, async (w) => {
    if (!w.node) {
      new Notice("Already at the story root.");
      return;
    }
    const parent = plugin.store.index.parentOf(w.node);
    if (parent) {
      await open(plugin, parent);
      return;
    }
    const root = plugin.store.storyRootFile(w.node.story);
    if (root) await open(plugin, root);
  });

  add("go-down", "Go to child node", () => true, async (w) => {
    const idx = plugin.store.index;
    const children = w.node ? idx.childrenOf(w.node) : idx.rootsOf(w.storyFolder);
    if (!children.length) {
      new Notice("No children yet. Use \"New node from here\".");
      return;
    }
    const target = await chooseNode(plugin, children, "Continue to…");
    if (target) await open(plugin, target);
  });

  const step = (id: string, name: string, kind: "version" | "regen", dir: -1 | 1): void => {
    add(id, name, (w) => !!w.node, async (w) => {
      const idx = plugin.store.index;
      const target = kind === "version" ? idx.stepVersion(w.node!, dir) : idx.stepRegen(w.node!, dir);
      if (!target) {
        new Notice(`No ${dir < 0 ? "previous" : "next"} ${kind === "version" ? "prompt version" : "regeneration"}.`);
        return;
      }
      await open(plugin, target);
      new Notice(positionText(plugin, target), 2500);
    });
  };
  step("prev-version", "Previous prompt version", "version", -1);
  step("next-version", "Next prompt version", "version", 1);
  step("prev-regen", "Previous regeneration", "regen", -1);
  step("next-regen", "Next regeneration", "regen", 1);

  add("last-active", "Go to the story's last active node", () => true, async (w) => {
    const id = plugin.lastActiveId(w.storyFolder);
    const meta = id ? plugin.store.index.get(w.storyFolder, id) : undefined;
    if (!meta) {
      new Notice("No last active node recorded on this device for this story.");
      return;
    }
    await open(plugin, meta);
  });

  // ---- context preview ------------------------------------------------------------------
  const preview = async (w: Where, ownPrompt: boolean): Promise<void> => {
    let parent: NodeMeta | null;
    let prompt: string;
    if (ownPrompt && w.node) {
      parent = plugin.store.index.parentOf(w.node) ?? null;
      prompt = (await plugin.store.load(w.file)).sections.prompt || "(empty prompt)";
    } else {
      parent = w.node ?? null;
      prompt = "(your next prompt goes here)";
    }
    const { config, context } = await plugin.generation.prepare(w.storyFolder, parent, prompt);
    const lines = [
      `${PROVIDER_LABEL[config.provider]} · ${config.model || "(no model selected)"}`,
      `Estimated input: ~${context.totalTokens} tokens`,
      ...context.parts.map((p) => `  ${p.label}: ~${p.tokens}`),
    ];
    if (context.linkedNotes.length) {
      lines.push("Linked notes included:");
      for (const n of context.linkedNotes) lines.push(`  ${n.title} (~${n.tokens}) — ${n.source}`);
    }
    for (const warn of context.warnings) lines.push(`⚠ ${warn}`);
    const body = context.messages.map((m) => `===== ${m.role.toUpperCase()} =====\n${m.content}`).join("\n\n");
    new TextViewModal(app, { title: "Context preview", summary: lines.join("\n"), body }).open();
  };
  add("preview-context-new", "Preview context for a new node from here", () => true, (w) => preview(w, false));
  add("preview-context-own", "Preview context of this node", (w) => !!w.node, (w) => preview(w, true));
}
