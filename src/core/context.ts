import { extractLinks, linkKey, stripLinks, uniqueLinks, WikiLink } from "./links";
import { estimateTokens } from "./tokens";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One earlier turn on the active path. */
export interface PathTurn {
  id: string;
  prompt: string;
  output: string;
  /** Valid summary of `output`, or null when none exists. */
  summary: string | null;
  /** The node's "Keep in mind" text. */
  keep: string;
}

export interface StoryContextInput {
  systemPrompt: string;
  lore: string;
  loreLinks: WikiLink[];
  pinned: string;
}

export interface ResolvedNote {
  title: string;
  text: string;
}

export interface ContextInput {
  story: StoryContextInput;
  /** Ancestors, oldest first, NOT including the new turn. */
  turns: PathTurn[];
  newPrompt: string;
  /** Number of most recent turns sent verbatim. Use Infinity to send everything. */
  recentTurns: number;
  resolveNote: (link: WikiLink) => Promise<ResolvedNote | null>;
}

export interface ContextPart {
  label: string;
  tokens: number;
}

export interface BuiltContext {
  messages: ChatMessage[];
  parts: ContextPart[];
  totalTokens: number;
  /** Notes pulled in through links: where they came from and how big they are. */
  linkedNotes: { title: string; tokens: number; source: string }[];
  warnings: string[];
}

const tag = (name: string, body: string, attrs = ""): string => `<${name}${attrs}>\n${body}\n</${name}>`;
const escapeAttr = (s: string): string => s.replace(/"/g, "'");

/**
 * Build the messages sent for a new node, in this order:
 * system prompt, lore (+ linked lore notes), pinned details, reference notes linked from
 * recent prompts and "keep in mind" lists, branch details, story so far (summaries of older
 * turns), recent turns verbatim, new prompt.
 */
export async function buildContext(input: ContextInput): Promise<BuiltContext> {
  const warnings: string[] = [];
  const { story, newPrompt } = input;

  // Turns without output (failed or still generating) cannot be shown as a pair.
  const turns = input.turns.filter((t) => {
    if (t.output.trim()) return true;
    warnings.push(`Skipped an earlier turn with no output (${t.id}).`);
    return false;
  });

  const n = input.recentTurns;
  const recentCount = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : turns.length;
  const older = turns.slice(0, Math.max(0, turns.length - recentCount));
  const recent = turns.slice(turns.length - Math.min(recentCount, turns.length));

  // ---- linked notes -----------------------------------------------------
  const seen = new Set<string>();
  const linkedNotes: BuiltContext["linkedNotes"] = [];

  const resolveAll = async (links: WikiLink[], source: string): Promise<string[]> => {
    const blocks: string[] = [];
    for (const link of uniqueLinks(links)) {
      const key = linkKey(link);
      if (seen.has(key)) continue;
      seen.add(key);
      const note = await input.resolveNote(link);
      if (!note) {
        warnings.push(`Linked note not found: ${link.raw} (${source}).`);
        continue;
      }
      const title = link.heading ? `${note.title} > ${link.heading}` : note.title;
      blocks.push(tag("note", note.text.trim(), ` title="${escapeAttr(title)}"`));
      linkedNotes.push({ title, tokens: estimateTokens(note.text), source });
    }
    return blocks;
  };

  const loreText = stripLinks(story.lore);
  const loreBlocks = await resolveAll([...story.loreLinks, ...extractLinks(story.lore)], "story lore");

  const refLinks: WikiLink[] = [];
  for (const t of turns) refLinks.push(...extractLinks(t.keep)); // inherited down the branch
  for (const t of recent) refLinks.push(...extractLinks(t.prompt)); // only while the turn is recent
  refLinks.push(...extractLinks(newPrompt));
  const refBlocks = await resolveAll(refLinks, "prompt / keep in mind");

  // ---- system message ---------------------------------------------------
  const parts: ContextPart[] = [];
  const sys: string[] = [];
  const addPart = (label: string, text: string): void => {
    if (!text.trim()) return;
    parts.push({ label, tokens: estimateTokens(text) });
  };

  addPart("System prompt", story.systemPrompt);
  if (story.systemPrompt.trim()) sys.push(story.systemPrompt.trim());

  const loreSection = [loreText, ...loreBlocks].filter((s) => s.trim()).join("\n\n");
  if (loreSection) {
    sys.push(tag("lore", loreSection));
    addPart("Lore", loreSection);
  }

  const pinned = stripLinks(story.pinned);
  if (pinned.trim()) {
    sys.push(tag("pinned_details", pinned.trim()));
    addPart("Pinned details", pinned);
  }

  if (refBlocks.length) {
    const body = refBlocks.join("\n\n");
    sys.push(tag("reference_notes", body));
    addPart("Reference notes", body);
  }

  const keepItems = turns.map((t) => stripLinks(t.keep).trim()).filter(Boolean);
  if (keepItems.length) {
    const body = keepItems.join("\n");
    sys.push(tag("keep_in_mind", body));
    addPart("Keep in mind (branch)", body);
  }

  const summaries: string[] = [];
  for (const t of older) {
    if (t.summary && t.summary.trim()) {
      summaries.push(t.summary.trim());
    } else {
      warnings.push(`No summary for turn ${t.id}; sending its full output instead.`);
      summaries.push(t.output.trim());
    }
  }
  if (summaries.length) {
    const body = summaries.map((s, i) => `${i + 1}. ${s}`).join("\n");
    sys.push(tag("story_so_far", body));
    addPart("Story so far (summaries)", body);
  }

  const messages: ChatMessage[] = [];
  if (sys.length) messages.push({ role: "system", content: sys.join("\n\n") });

  let recentTokens = 0;
  for (const t of recent) {
    const user = stripLinks(t.prompt);
    messages.push({ role: "user", content: user });
    messages.push({ role: "assistant", content: t.output.trim() });
    recentTokens += estimateTokens(user) + estimateTokens(t.output);
  }
  if (recentTokens) parts.push({ label: `Recent turns (${recent.length})`, tokens: recentTokens });

  const finalPrompt = stripLinks(newPrompt).trim();
  messages.push({ role: "user", content: finalPrompt });
  parts.push({ label: "New prompt", tokens: estimateTokens(finalPrompt) });

  const totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
  return { messages, parts, totalTokens, linkedNotes, warnings };
}
