import { extractLinks, WikiLink } from "./links";
import { emitYaml, YamlValue } from "./yaml";

/** Parsed content of a story's root note (`_story.md`). */
export interface StoryDoc {
  systemPrompt: string;
  /** Free-text lore written directly in the root note. Wikilinks inside are expanded. */
  lore: string;
  pinned: string;
}

export const STORY_ROOT_FILE = "_story.md";
export const NODES_FOLDER = "nodes";

const SECTION_KEYS: { [heading: string]: keyof StoryDoc } = {
  "system prompt": "systemPrompt",
  lore: "lore",
  "pinned details": "pinned",
};

export function parseStoryBody(body: string): StoryDoc {
  const doc: StoryDoc = { systemPrompt: "", lore: "", pinned: "" };
  let current: keyof StoryDoc | null = null;
  const buf: { [K in keyof StoryDoc]: string[] } = { systemPrompt: [], lore: [], pinned: [] };
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
    `<!-- Optional overrides in the properties above: provider, model, temperature, max_tokens, top_p, recent_turns.\n     "lore" takes links such as "[[Atka]]". Everything below is sent to the model with every turn, never summarized. -->`,
    `## System prompt\nYou are a skilled fiction writer. The user gives a short brief for the next part of the story; expand it into vivid, consistent prose in the same style as the story so far. Write only the story text, with no commentary.`,
    `## Lore\nWrite the essential background here. Notes linked with double square brackets (or listed in the "lore" property) are sent in full.`,
    `## Pinned details\n- Details that must always stay true.`,
  ].join("\n\n") + "\n";
}
