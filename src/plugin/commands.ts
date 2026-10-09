import { Notice, TFile, normalizePath } from "obsidian";
import { PROVIDER_LABEL } from "../api/client";
import { NODES_FOLDER, newStoryNote, STORY_ROOT_FILE } from "../core/storyDoc";
import { NodeMeta } from "../core/tree";
import {
  compilePath,
  goDown,
  goStep,
  goUp,
  openNode,
  pickRegen,
  pickVersion,
  setLabel,
  toggleStar,
} from "./actions";
import type BranchingStoriesPlugin from "./main";
import { NameModal, PromptModal, TextViewModal } from "./modals";
import { SummaryCancelled } from "./summaries";

export interface Where {
  storyFolder: string;
  /** The open node, or undefined when the open note is the story root. */
  node?: NodeMeta;
  file: TFile;
}

export function whereAmI(plugin: BranchingStoriesPlugin): Where | null {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) return null;
  if (plugin.store.isStoryRoot(file)) {
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    return { storyFolder: folder, file };
  }
  const node = plugin.store.nodeOf(file);
  return node ? { storyFolder: node.story, node, file } : null;
}

/** Prompt dialog, then generate a child of the open node (or the first node from the story root). */
export async function newNode(plugin: BranchingStoriesPlugin, w: Where): Promise<void> {
  const prompt = await new PromptModal(plugin.app, {
    title: w.node ? "Next prompt" : "First prompt",
    submitLabel: "Generate",
    placeholder: "What happens next? You can link notes with [[Note name]] to include them.",
  }).open();
  if (!prompt) return;
  await plugin.generation.run({ storyFolder: w.storyFolder, parent: w.node ?? null, prompt, regenOf: null });
}

export async function regenerate(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  if (plugin.generation.isGenerating(node)) {
    new Notice("This node is still generating.");
    return;
  }
  const file = plugin.store.fileFor(node);
  if (!file) return;
  const loaded = await plugin.store.load(file);
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
}

export async function editAndRegenerate(plugin: BranchingStoriesPlugin, node: NodeMeta): Promise<void> {
  const file = plugin.store.fileFor(node);
  if (!file) return;
  const loaded = await plugin.store.load(file);
  const prompt = await new PromptModal(plugin.app, {
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
      new Notice('Story created. Edit the system prompt and lore, then run "New node from here".');
    },
  });

  // ---- generation -----------------------------------------------------------------
  add("new-node", "New node from here", () => true, (w) => newNode(plugin, w));
  add("regenerate", "Regenerate", (w) => !!w.node, (w) => regenerate(plugin, w.node!));
  add("edit-regenerate", "Edit prompt and regenerate", (w) => !!w.node, (w) => editAndRegenerate(plugin, w.node!));

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
    await goUp(plugin, w.node);
  });
  add("go-down", "Go to child node", () => true, (w) => goDown(plugin, w.node ?? null, w.storyFolder));
  add("prev-version", "Previous prompt version", (w) => !!w.node, (w) => goStep(plugin, w.node!, "version", -1));
  add("next-version", "Next prompt version", (w) => !!w.node, (w) => goStep(plugin, w.node!, "version", 1));
  add("prev-regen", "Previous regeneration", (w) => !!w.node, (w) => goStep(plugin, w.node!, "regen", -1));
  add("next-regen", "Next regeneration", (w) => !!w.node, (w) => goStep(plugin, w.node!, "regen", 1));
  add("pick-version", "Choose prompt version…", (w) => !!w.node, (w) => pickVersion(plugin, w.node!));
  add("pick-regen", "Choose regeneration…", (w) => !!w.node, (w) => pickRegen(plugin, w.node!));

  add("last-active", "Go to the story's last active node", () => true, async (w) => {
    const id = plugin.lastActiveId(w.storyFolder);
    const meta = id ? plugin.store.index.get(w.storyFolder, id) : undefined;
    if (!meta) {
      new Notice("No last active node recorded on this device for this story.");
      return;
    }
    await openNode(plugin, meta);
  });

  // ---- bookmarks, summaries, output --------------------------------------------------
  add("toggle-star", "Toggle star on this node", (w) => !!w.node, (w) => toggleStar(plugin, w.node!));
  add("set-label", "Set branch label…", (w) => !!w.node, (w) => setLabel(plugin, w.node!));

  add("regenerate-summary", "Regenerate summary of this node", (w) => !!w.node, async (w) => {
    try {
      const data = await plugin.generation.loadStory(w.storyFolder);
      await plugin.summaries.regenerate(w.node!, data.config);
    } catch (e) {
      if (e instanceof SummaryCancelled) return;
      throw e;
    }
  });

  add("compile-path", "Compile path to note", (w) => !!w.node, (w) => compilePath(plugin, w.node!));

  plugin.addCommand({
    id: "open-sidebar",
    name: "Open story sidebar",
    callback: () => void plugin.activateSidebar(),
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
    const data = await plugin.generation.loadStory(w.storyFolder);
    const { config, context } = await plugin.generation.prepare(data, parent, prompt, "preview");
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
