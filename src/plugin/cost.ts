import { FRAGMENTS_FOLDER } from "../core/fragment";
import { fmtCost, nodeCost, pathCost, roundCost, storyCost, StoryCost } from "../core/cost";
import { NodeMeta } from "../core/tree";
import type BranchingStoriesPlugin from "./main";
import { TextViewModal } from "./modals";

/** What tagging fragments of this story cost, from the `tag_cost` property each fragment note carries. */
function taggingCost(plugin: BranchingStoriesPlugin, story: string): number {
  const prefix = `${story}/${FRAGMENTS_FOLDER}/`;
  let sum = 0;
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(prefix)) continue;
    const v = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.tag_cost;
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return roundCost(sum);
}

export function costOfStory(plugin: BranchingStoriesPlugin, story: string): StoryCost {
  return storyCost(plugin.store.index.inStory(story), taggingCost(plugin, story));
}

/** Cost of the open node, of the path leading to it, and of the whole story, broken down. */
export function costReport(plugin: BranchingStoriesPlugin, story: string, node: NodeMeta | null): { summary: string; body: string } {
  const s = costOfStory(plugin, story);
  const lines: string[] = [];

  if (node) {
    const path = plugin.store.index.pathTo(node);
    const onPath = pathCost(path);
    lines.push(`This node: ${fmtCost(nodeCost(node))}` + (node.summaryCost ? ` (generation ${fmtCost(node.cost ?? 0)}, its summaries ${fmtCost(node.summaryCost)})` : ""));
    lines.push(`This path (${path.length} nodes): ${fmtCost(onPath)}`);
    lines.push(`Other versions, regenerations and branches: ${fmtCost(roundCost(s.generation + s.summaries - onPath))}`);
    lines.push("");
  }
  lines.push(`Whole story: ${fmtCost(s.total)}`);
  lines.push(`  Generation: ${fmtCost(s.generation)}`);
  lines.push(`  Summaries: ${fmtCost(s.summaries)}`);
  lines.push(`  Fragment tagging: ${fmtCost(s.tagging)}`);
  if (s.nodesWithoutCost) {
    lines.push(`${s.nodesWithoutCost} of ${s.nodesWithCost + s.nodesWithoutCost} nodes have no cost recorded (stopped or failed, LM Studio, or written before costs were saved).`);
  }

  const body = s.byModel.length
    ? s.byModel
        .map((m) => `${m.model}\n    ${m.nodes} node${m.nodes === 1 ? "" : "s"} · ${fmtCost(m.cost)} · avg ${fmtCost(m.cost / m.nodes)} each`)
        .join("\n\n")
    : "No generation costs recorded yet.";
  return { summary: lines.join("\n"), body };
}

export function showCost(plugin: BranchingStoriesPlugin, story: string, node: NodeMeta | null): void {
  const { summary, body } = costReport(plugin, story, node);
  new TextViewModal(plugin.app, { title: `Spent on ${story.split("/").pop() || "this story"}`, summary, body }).open();
}
