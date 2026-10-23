import { extractLinks, WikiLink } from "./links";
import { emitYaml, YamlValue } from "./yaml";

/** Parsed content of a story's root note (`_story.md`). */
export interface StoryDoc {
  systemPrompt: string;
  /** Free-text lore written directly in the root note. Wikilinks inside are expanded. */
  lore: string;
  pinned: string;
  /** Style sample: text and/or links to notes; sent as its own block, never summarized. */
  style: string;
}

export const STORY_ROOT_FILE = "_story.md";
export const NODES_FOLDER = "nodes";

const SECTION_KEYS: { [heading: string]: keyof StoryDoc } = {
  "system prompt": "systemPrompt",
  lore: "lore",
  "pinned details": "pinned",
  "style sample": "style",
};

export function parseStoryBody(body: string): StoryDoc {
  const doc: StoryDoc = { systemPrompt: "", lore: "", pinned: "", style: "" };
  let current: keyof StoryDoc | null = null;
  const buf: { [K in keyof StoryDoc]: string[] } = { systemPrompt: [], lore: [], pinned: [], style: [] };
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^##\s+(.*?)\s*$/);
    if (m) {
      current = SECTION_KEYS[m[1].toLowerCase()] ?? null;
      continue;
    }
    if (current) buf[current].push(line);
  }
  for (const k of Object.keys(buf) as (keyof StoryDoc)[]) {
    doc[k] = buf[k].join("\n").trim();
  }
  return doc;
}

/** Links listed in the `lore:` frontmatter property (strings like `[[Atka]]`). */
export function linksFromLoreProperty(value: unknown): WikiLink[] {
  const items: unknown[] = Array.isArray(value) ? value : value ? [value] : [];
  const out: WikiLink[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const found = extractLinks(item);
    if (found.length) out.push(...found);
    else if (item.trim()) out.push({ target: item.trim(), heading: null, alias: null, raw: item });
  }
  return out;
}

export type StylePosition = "start" | "before-log" | "end";

/**
 * `style_position` property: `end` (default) puts the sample in the final user message after the
 * recent turns, `before-log` at the end of the system message, `start` right after the system prompt.
 */
export function stylePositionFromFrontmatter(fm: Record<string, unknown> | undefined): StylePosition {
  const v = typeof fm?.style_position === "string" ? fm.style_position.trim().toLowerCase() : "";
  return v === "start" || v === "before-log" ? v : "end";
}

export interface StoryOverrides {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  recentTurns?: number;
}

/** Per-story overrides stored in the root note frontmatter. */
export function overridesFromFrontmatter(fm: Record<string, unknown> | undefined): StoryOverrides {
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  if (!fm) return {};
  return {
    provider: str(fm.provider),
    model: str(fm.model),
    temperature: num(fm.temperature),
    maxTokens: num(fm.max_tokens),
    topP: num(fm.top_p),
    recentTurns: num(fm.recent_turns),
  };
}

export function newStoryNote(name: string): string {
  const fm: { [k: string]: YamlValue } = { branching_story: true, lore: [] };
  return [
    `---\n${emitYaml(fm)}\n---`,
    `# ${name}`,
    `<!-- Optional overrides in the properties above: provider, model, temperature, max_tokens, top_p, recent_turns, style_position.\n     "lore" takes links such as "[[Atka]]". Everything below is sent to the model with every turn, never summarized.\n     Style sample (empty section at the end): one or two paragraphs in the voice you want, and/or a link such as "[[My voice]]".\n     style_position (add it as a property; default is end) says where the style sample goes:\n       end         in the last message, right before your new prompt, after the recent turns (default)\n       before-log  at the end of the system message, before the recent turns\n       start       in the system message, right after the system prompt -->`,
    `## System prompt\nYou are a skilled fiction writer. The user gives a short brief for the next part of the story; expand it into vivid, consistent prose in the same style as the story so far. Write only the story text, with no commentary.`,
    `## Lore\nWrite the essential background here. Notes linked with double square brackets (or listed in the "lore" property) are sent in full.`,
    `## Pinned details\n- Details that must always stay true.`,
    `## Style sample\n`,
  ].join("\n\n") + "\n";
}
