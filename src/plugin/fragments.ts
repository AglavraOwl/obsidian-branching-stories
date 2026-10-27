import { MarkdownView, Notice, TFile, normalizePath } from "obsidian";
import { chatCompletion } from "../api/client";
import {
  ALL_FRAGMENTS_BASE_FILE,
  allBaseText,
  FRAGMENTS_BASE_FILE,
  FRAGMENTS_FOLDER,
  fragmentFileName,
  locatePassage,
  parseTagList,
  parseTagReply,
  serializeFragment,
  storyBaseText,
  tagMessages,
} from "../core/fragment";
import { makeWikilink } from "../core/ids";
import { NodeMeta } from "../core/tree";
import type { Where } from "./commands";
import type BranchingStoriesPlugin from "./main";

/** A remembered selection stays usable this long: opening a menu can clear the real one. */
const REMEMBER_MS = 2 * 60 * 1000;

const TAG_TEMPERATURE = 0.2;
const TAG_MAX_TOKENS = 400;

/** The text selected in a note's view: the Markdown source in the editor, the rendered text in Reading view. */
export function liveSelection(view: MarkdownView): string {
  if (view.getMode() === "source") return view.editor.getSelection();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode || !view.contentEl.contains(sel.anchorNode)) return "";
  return sel.toString();
}

/**
 * Remembers the last non-empty selection made in a note. On a phone, tapping a header button or a
 * menu can drop the selection before the action runs; the remembered one is used then.
 */
export class SelectionTracker {
  private last: { text: string; path: string; at: number } | null = null;

  constructor(private plugin: BranchingStoriesPlugin) {}

  start(): void {
    this.plugin.registerDomEvent(document, "selectionchange", () => this.capture());
  }

  private capture(): void {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    const text = liveSelection(view);
    if (text.trim()) this.last = { text, path: view.file.path, at: Date.now() };
  }

  /** The selection in this note now, or the one made in it a moment ago. Empty when there is none. */
  take(file: TFile): string {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path) {
      const live = liveSelection(view);
      if (live.trim()) return live;
    }
    const last = this.last;
    return last && last.path === file.path && Date.now() - last.at < REMEMBER_MS ? last.text : "";
  }
}

export async function saveSelectionAsFragment(plugin: BranchingStoriesPlugin, w: Where): Promise<void> {
  if (!w.node) {
    new Notice("Open a node of the story and select some text in it first.");
    return;
  }
  const passage = plugin.selection.take(w.file);
  if (!passage.trim()) {
    new Notice("Select some text in this node first.");
    return;
  }
  await saveFragment(plugin, w.node, passage);
}

const snippet = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Writes the fragment note at once, then asks a model for tags and adds them when they arrive. */
export async function saveFragment(plugin: BranchingStoriesPlugin, node: NodeMeta, passage: string): Promise<TFile | null> {
  const { app } = plugin;
  const nodeFile = plugin.store.fileFor(node);
  if (!nodeFile) return null;
  const loaded = await plugin.store.load(nodeFile);
  const where = locatePassage(passage, loaded.sections);

  const folder = normalizePath(`${node.story}/${FRAGMENTS_FOLDER}`);
  await plugin.ensureFolder(folder);
  await ensureFile(plugin, normalizePath(`${folder}/${FRAGMENTS_BASE_FILE}`), storyBaseText(folder));

  const created = new Date();
  const base = fragmentFileName(created, passage).replace(/\.md$/, "");
  let path = normalizePath(`${folder}/${base}.md`);
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`);

  const story = node.story.split("/").pop() ?? node.story;
  const file = await app.vault.create(
    path,
    serializeFragment({ story, source: makeWikilink(nodeFile.basename), section: where.section, created, tags: [] }, passage),
  );

  const settings = plugin.settings.fragments;
  if (!settings.autoTag) {
    new Notice(`Fragment saved: “${snippet(passage, 50)}”`);
    return file;
  }
  const notice = new Notice(`Fragment saved: “${snippet(passage, 50)}”\nAdding tags…`, 0);
  const finish = (message: string): void => {
    notice.setMessage(message);
    window.setTimeout(() => notice.hide(), 5000);
  };
  try {
    const tags = await tagPassage(plugin, node, passage, where.context);
    if (!tags.length) {
      finish(`Fragment saved: “${snippet(passage, 50)}”\nThe model gave no tags; add them by hand.`);
      return file;
    }
    await app.fileManager.processFrontMatter(file, (fm) => {
      if (!Array.isArray(fm.tags) || fm.tags.length === 0) fm.tags = tags; // never replace tags typed meanwhile
    });
    finish(`Fragment saved: “${snippet(passage, 50)}”\nTags: ${tags.join(", ")}`);
  } catch (e) {
    console.error("[Branching Stories] tagging failed", e);
    finish(`Fragment saved without tags: ${e instanceof Error ? e.message : String(e)}`);
  }
  return file;
}

async function tagPassage(plugin: BranchingStoriesPlugin, node: NodeMeta, passage: string, context: string): Promise<string[]> {
  const s = plugin.settings.fragments;
  let target = { provider: s.provider, model: s.model };
  if (s.useGenerationModel) {
    const { config } = await plugin.generation.loadStory(node.story);
    target = { provider: config.provider, model: config.model };
  }
  await plugin.ensureModel(target.provider, target.model);
  const provider = plugin.providerConfig(target.provider);
  if (target.provider === "openrouter" && !provider.apiKey) throw new Error("OpenRouter API key is not set.");

  const vocabulary = parseTagList(s.tags);
  const result = await chatCompletion(
    provider,
    {
      model: target.model,
      messages: tagMessages(passage, context, vocabulary),
      temperature: TAG_TEMPERATURE,
      maxTokens: TAG_MAX_TOKENS,
      stream: false,
    },
    {},
    plugin.clientDeps,
  );
  return parseTagReply(result.text, vocabulary);
}

/** Creates the file with this text unless something is there already (a table the author changed stays as it is). */
async function ensureFile(plugin: BranchingStoriesPlugin, path: string, text: string): Promise<TFile> {
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  return plugin.app.vault.create(path, text);
}

/** Opens the Bases table of one story's fragments, or of all fragments when no story is given. */
export async function openFragmentsTable(plugin: BranchingStoriesPlugin, storyFolder: string | null): Promise<void> {
  let file: TFile;
  if (storyFolder === null) {
    const root = normalizePath(plugin.settings.storiesRoot);
    await plugin.ensureFolder(root);
    file = await ensureFile(plugin, normalizePath(`${root}/${ALL_FRAGMENTS_BASE_FILE}`), allBaseText());
  } else {
    const folder = normalizePath(`${storyFolder}/${FRAGMENTS_FOLDER}`);
    await plugin.ensureFolder(folder);
    file = await ensureFile(plugin, normalizePath(`${folder}/${FRAGMENTS_BASE_FILE}`), storyBaseText(folder));
  }
  try {
    await plugin.app.workspace.getLeaf(false).openFile(file);
  } catch (e) {
    new Notice(
      `Could not open ${file.path}. Tables need Obsidian 1.9.10 or newer with the Bases core plugin turned on. ` +
        (e instanceof Error ? e.message : String(e)),
      12000,
    );
  }
}
