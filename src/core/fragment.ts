import { ChatMessage } from "./context";
import { makeTitle, makeTimestamp } from "./ids";
import { emitYaml } from "./yaml";

export const FRAGMENTS_FOLDER = "Fragments";
export const FRAGMENTS_BASE_FILE = "Fragments.base";
export const ALL_FRAGMENTS_BASE_FILE = "All fragments.base";
/** Value of the `type` property that marks a note as a fragment (the combined table filters on it). */
export const FRAGMENT_TYPE = "fragment";

export const DEFAULT_FRAGMENT_TAGS =
  "description, dialogue, emotion, metaphor, sensory, action, setting, character, humor, tension";

const MAX_TAGS = 5;
const MAX_CONTEXT_CHARS = 1500;

export type FragmentSection = "prompt" | "output";

export interface FragmentInfo {
  story: string;
  /** Wikilink to the node the passage was taken from. */
  source: string;
  section?: FragmentSection;
  created: Date;
  tags: string[];
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `2026-10-27 1415 First few words.md`; the caller adds " 2", " 3"... if the name is taken. */
export function fragmentFileName(created: Date, text: string): string {
  const stamp = `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())} ${pad(created.getHours())}${pad(created.getMinutes())}`;
  return `${stamp} ${makeTitle(text, 6)}.md`;
}

/**
 * The fragment note. The passage is the `text` property, because a Bases table can show properties
 * but not the body of a note; the body is left free for the author. `comment` is for the author too.
 */
export function serializeFragment(info: FragmentInfo, text: string): string {
  const fm = emitYaml({
    type: FRAGMENT_TYPE,
    story: info.story,
    source: info.source,
    section: info.section,
    created: makeTimestamp(info.created),
    tags: info.tags,
    comment: "",
    text: text.trim(),
  });
  return `---\n${fm}\n---\n`;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Where in a node a selected passage comes from, and the paragraph around it (given to the tagging
 * model so it sees more than the cut). Text selected in Reading view has no Markdown marks, so a
 * passage that is not found keeps the passage itself as its context and no section.
 */
export function locatePassage(
  passage: string,
  sections: { prompt: string; output: string },
): { section?: FragmentSection; context: string } {
  const needle = collapse(passage);
  // A selection can start in one paragraph and end in another, so look at the whole section first,
  // then take the paragraph the selection starts in.
  const head = collapse(passage.trim().split(/\n\s*\n/)[0]).slice(0, 60);
  for (const section of ["output", "prompt"] as const) {
    if (!needle || !collapse(sections[section]).includes(needle)) continue;
    const paragraph = sections[section].split(/\n\s*\n/).find((p) => collapse(p).includes(head));
    const context = paragraph !== undefined && collapse(paragraph).length >= needle.length ? paragraph.trim() : passage.trim();
    return { section, context: context.slice(0, MAX_CONTEXT_CHARS) };
  }
  return { context: passage.trim().slice(0, MAX_CONTEXT_CHARS) };
}

/** Tag vocabulary typed in the settings: comma or line separated. */
export function parseTagList(text: string): string[] {
  return normalizeTags(text.split(/[,\n]/));
}

/** Lower case, words joined with `-`, no `#`, no repeats, no empty entries. */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const t of raw) {
    const tag = String(t)
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}_/-]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export function tagMessages(passage: string, context: string, vocabulary: string[]): ChatMessage[] {
  const list = vocabulary.length ? vocabulary.join(", ") : "(none given: invent short lower-case tags)";
  const around = context.trim() && collapse(context) !== collapse(passage) ? `<context>\n${context.trim()}\n</context>\n\n` : "";
  return [
    {
      role: "system",
      content:
        "You label short passages of fiction with tags that help a writer find them later. " +
        'Reply with a JSON array of strings only, for example ["description","sensory"].',
    },
    {
      role: "user",
      content:
        `Choose 2 to 4 tags for the passage. Prefer tags from this list: ${list}. ` +
        "Add at most one new tag (one lowercase word) only if nothing on the list fits what makes the passage worth keeping.\n\n" +
        `${around}<passage>\n${passage.trim()}\n</passage>`,
    },
  ];
}

/**
 * Tags from the model's reply: a JSON array, or a plain comma/line separated list as a fallback.
 * Tags on the list come first; at most one tag that is not on the list is kept.
 */
export function parseTagReply(reply: string, vocabulary: string[]): string[] {
  let raw: string[] = [];
  const array = reply.match(/\[[\s\S]*?\]/);
  if (array) {
    try {
      const parsed: unknown = JSON.parse(array[0]);
      if (Array.isArray(parsed)) raw = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // fall through to the plain list
    }
  }
  if (!raw.length) raw = reply.replace(/[[\]"`]/g, "").split(/[,\n]/);
  const tags = normalizeTags(raw);
  const known = new Set(normalizeTags(vocabulary));
  const listed = tags.filter((t) => known.has(t));
  const added = tags.filter((t) => !known.has(t)).slice(0, known.size ? 1 : MAX_TAGS);
  return [...listed, ...added].slice(0, MAX_TAGS);
}

const yamlSingle = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * Columns: the passage, tags, the author's comment, story, source. Newest first. The text column is wide
 * and rows are tall so a couple of sentences show in full; both can be changed in the table's own menu.
 */
const BASE_VIEW = `properties:
  note.text:
    displayName: Text
  note.tags:
    displayName: Tags
  note.comment:
    displayName: Comment
  note.story:
    displayName: Story
  note.source:
    displayName: Source
views:
  - type: table
    name: Fragments
    rowHeight: tall
    order:
      - note.text
      - note.tags
      - note.comment
      - note.story
      - note.source
    sort:
      - property: note.created
        direction: DESC
    columnSize:
      note.text: 420
      note.tags: 200
      note.comment: 260
      note.story: 120
      note.source: 200
`;

/** A Bases table of the fragments inside one folder (a story's `Fragments` folder). */
export function storyBaseText(folder: string): string {
  const inFolder = yamlSingle(`file.inFolder("${folder.replace(/"/g, "")}")`);
  // The type filter keeps the table file itself (and any other note) out of the list.
  return `filters:\n  and:\n    - ${inFolder}\n    - ${yamlSingle(`type == "${FRAGMENT_TYPE}"`)}\n${BASE_VIEW}`;
}

/** A Bases table of every fragment in the vault, whichever story it belongs to. */
export function allBaseText(): string {
  return `filters:\n  and:\n    - ${yamlSingle(`type == "${FRAGMENT_TYPE}"`)}\n${BASE_VIEW}`;
}

/** Fragments saved by 0.4.0 keep the passage in the body: the text to move into the `text` property. */
export function textToMigrate(frontmatter: Record<string, unknown>, body: string): string | null {
  if (frontmatter.type !== FRAGMENT_TYPE) return null;
  if (typeof frontmatter.text === "string" && frontmatter.text.trim()) return null;
  return body.trim() || null;
}
