import { Notice } from "obsidian";
import {
  compilePath,
  goDown,
  goStep,
  goUp,
  nodeInfo,
  openNode,
  pickRegen,
  pickVersion,
  setLabel,
  toggleStar,
} from "./actions";
import { editAndRegenerate, newNode, regenerate, whereAmI } from "./commands";
import { runConnectionTest } from "./diagnostics";
import type BranchingStoriesPlugin from "./main";
import { ChoiceModal } from "./modals";
import { SummaryCancelled } from "./summaries";

interface MenuItem {
  label: string;
  run: () => Promise<void>;
}

/** One list with every action that applies to the open note, so no typing is needed on a phone. */
export async function showStoryMenu(plugin: BranchingStoriesPlugin): Promise<void> {
  const w = whereAmI(plugin);
  if (!w) {
    new Notice("Open a story note (the story root or one of its nodes) first.");
    return;
  }
  const items: MenuItem[] = [];
  const add = (label: string, run: () => Promise<void>): void => {
    items.push({ label, run });
  };

  const node = w.node;
  if (node && plugin.generation.isGenerating(node)) {
    add("Stop generation", async () => {
      plugin.generation.stop(node);
    });
  }
  add(node ? "New node from here" : "Write the first node", () => newNode(plugin, w));

  if (node) {
    const info = nodeInfo(plugin, node);
    add("Regenerate", () => regenerate(plugin, node));
    add("Edit prompt and regenerate", () => editAndRegenerate(plugin, node));

    add("Go to parent", () => goUp(plugin, node));
    if (info.children) add(`Go to child (${info.children})`, () => goDown(plugin, node, node.story));
    if (info.version.index > 1) add(`Previous prompt version (${info.version.index} of ${info.version.total})`, () => goStep(plugin, node, "version", -1));
    if (info.version.index < info.version.total) add(`Next prompt version (${info.version.index} of ${info.version.total})`, () => goStep(plugin, node, "version", 1));
    if (info.version.total > 1) add("Choose prompt version…", () => pickVersion(plugin, node));
    if (info.regen.index > 1) add(`Previous regeneration (${info.regen.index} of ${info.regen.total})`, () => goStep(plugin, node, "regen", -1));
    if (info.regen.index < info.regen.total) add(`Next regeneration (${info.regen.index} of ${info.regen.total})`, () => goStep(plugin, node, "regen", 1));
    if (info.regen.total > 1) add("Choose regeneration…", () => pickRegen(plugin, node));

    add(node.starred ? "Remove star" : "Star this node", () => toggleStar(plugin, node));
    add(node.label ? `Change label (${node.label})` : "Set branch label…", () => setLabel(plugin, node));
    add("Compile path to note", () => compilePath(plugin, node));
    add("Regenerate summary of this node", async () => {
      try {
        const data = await plugin.generation.loadStory(w.storyFolder);
        await plugin.summaries.regenerate(node, data.config);
      } catch (e) {
        if (!(e instanceof SummaryCancelled)) throw e;
      }
    });
  } else {
    add("Go to first node", () => goDown(plugin, null, w.storyFolder));
  }

  const lastId = plugin.lastActiveId(w.storyFolder);
  const last = lastId ? plugin.store.index.get(w.storyFolder, lastId) : undefined;
  if (last && last.id !== node?.id) add("Go to the last active node", () => openNode(plugin, last));
  add("Open story sidebar", () => plugin.activateSidebar());
  add("Test connection", () => runConnectionTest(plugin));

  const chosen = await new ChoiceModal<MenuItem>(plugin.app, items, (i) => i.label, "Story actions").openAndWait();
  if (chosen) await chosen.run();
}
