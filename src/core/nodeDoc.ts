import { emitYaml, YamlValue } from "./yaml";

export type NodeStatus = "generating" | "done" | "failed" | "stopped";

export interface NodeFrontmatter {
  id: string;
  /** Quoted wikilink to the parent node, or "" for the first node. */
  parent: string;
  regen_of?: string;
  created: string;
  status: NodeStatus;
  provider?: string;
  model?: string;
  settings?: { [k: string]: YamlValue };
  usage?: { [k: string]: YamlValue };
  summary_hash?: string;
  /** Hash of the summary text as the plugin wrote it; a mismatch means the author edited it. */
  summary_check?: string;
  summary_locked?: boolean;
  starred?: boolean;
  label?: string;
  error?: string;
}

export interface NodeSections {
  prompt: string;
  output: string;
  reasoning: string;
  summary: string;
  keep: string;
}

export const EMPTY_SECTIONS: NodeSections = { prompt: "", output: "", reasoning: "", summary: "", keep: "" };

export type SectionName = keyof NodeSections;

const HEADINGS: { [K in Exclude<SectionName, "reasoning">]: string } = {
  prompt: "## Prompt",
  output: "## Output",
  summary: "## Summary",
  keep: "## Keep in mind",
};
const REASONING_MARKER = /^>\s*\[!note\]-\s*Reasoning\s*$/i;
const MARKER_ORDER: SectionName[] = ["prompt", "output", "reasoning", "summary", "keep"];

/** Split `---` frontmatter from the body. CRLF is normalised to LF. */
export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  const t = text.replace(/\r\n/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { frontmatter: null, body: t };
  return { frontmatter: m[1], body: t.slice(m[0].length) };
}

/** Stop user/model text from forging one of our section headings. */
function defang(text: string): string {
  return text.replace(/^## (Prompt|Output|Summary|Keep in mind)[ \t]*$/gm, "### $1");
}

function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "").replace(/^[ \t]+$/, "");
}

function reasoningToCallout(reasoning: string): string {
  const lines = reasoning.trim().split("\n").map((l) => (l.length ? `> ${l}` : ">"));
  return `> [!note]- Reasoning\n${lines.join("\n")}`;
}

function calloutToReasoning(lines: string[]): string {
  return lines
    .slice(1)
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

export function serializeFrontmatter(fm: NodeFrontmatter): string {
  const ordered: { [k: string]: YamlValue } = {
    id: fm.id,
    parent: fm.parent,
    regen_of: fm.regen_of,
    created: fm.created,
    status: fm.status,
    provider: fm.provider,
    model: fm.model,
    settings: fm.settings,
    usage: fm.usage,
    summary_hash: fm.summary_hash,
    summary_check: fm.summary_check,
    summary_locked: fm.summary_locked,
    starred: fm.starred,
    label: fm.label,
    error: fm.error,
  };
  return `---\n${emitYaml(ordered)}\n---\n`;
}

export function serializeBody(s: NodeSections): string {
  const parts = [
    `${HEADINGS.prompt}\n${defang(s.prompt.trim())}`,
    `${HEADINGS.output}\n${defang(s.output.trim())}`,
  ];
  if (s.reasoning.trim()) parts.push(reasoningToCallout(s.reasoning));
  parts.push(`${HEADINGS.summary}\n${defang(s.summary.trim())}`);
  parts.push(`${HEADINGS.keep}\n${defang(s.keep.trim())}`);
  return parts.map((p) => p.replace(/\n+$/, "")).join("\n\n") + "\n";
}

export function serializeNode(fm: NodeFrontmatter, s: NodeSections): string {
  return `${serializeFrontmatter(fm)}\n${serializeBody(s)}`;
}

interface SectionRange {
  name: SectionName;
  /** Line index of the heading / callout opener. */
  start: number;
  /** Exclusive end line index. */
  end: number;
}

/** Locate our sections in a body (first occurrence of each, in document order). */
function scanSections(lines: string[]): SectionRange[] {
  const found: SectionRange[] = [];
  let lastRank = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    let name: SectionName | null = null;
    for (const key of ["prompt", "output", "summary", "keep"] as const) {
      if (line === HEADINGS[key]) name = key;
    }
    if (!name && REASONING_MARKER.test(line)) name = "reasoning";
    if (!name) continue;
    const rank = MARKER_ORDER.indexOf(name);
    if (rank <= lastRank) continue; // repeated or out-of-order marker: plain content
    if (name === "reasoning") {
      // The callout runs while lines stay quoted.
      let j = i + 1;
      while (j < lines.length && /^>/.test(lines[j])) j++;
      found.push({ name, start: i, end: j });
      lastRank = rank;
      i = j - 1;
      continue;
    }
    found.push({ name, start: i, end: lines.length });
    lastRank = rank;
  }
  // Close each heading section at the next marker.
  for (let k = 0; k < found.length - 1; k++) {
    if (found[k].name !== "reasoning") found[k].end = Math.min(found[k].end, found[k + 1].start);
  }
  return found;
}

export function parseBody(body: string): NodeSections {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: NodeSections = { ...EMPTY_SECTIONS };
  for (const r of scanSections(lines)) {
    if (r.name === "reasoning") {
      out.reasoning = calloutToReasoning(lines.slice(r.start, r.end));
    } else {
      out[r.name] = trimBlankLines(lines.slice(r.start + 1, r.end).join("\n"));
    }
  }
  return out;
}

export function parseNodeText(text: string): { frontmatter: string | null; sections: NodeSections } {
  const { frontmatter, body } = splitFrontmatter(text);
  return { frontmatter, sections: parseBody(body) };
}

/**
 * Replace one section's content inside a full note text, keeping everything else
 * byte-for-byte (frontmatter included). Appends the section if it is missing.
 */
export function replaceSection(text: string, name: SectionName, content: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/);
  const head = fmMatch ? fmMatch[0] : "";
  const body = normalized.slice(head.length);
  const lines = body.split("\n");
  const ranges = scanSections(lines);
  const target = ranges.find((r) => r.name === name);
  const clean = defang(content.trim());

  const block = (): string[] => {
    if (name === "reasoning") return clean ? reasoningToCallout(clean).split("\n") : [];
    return [HEADINGS[name], ...(clean ? clean.split("\n") : [])];
  };

  if (target) {
    const replacement = block();
    // blank line before the next block, or the file's trailing newline at EOF
    // (a callout stops at the first unquoted line, which is already that blank line)
    if (replacement.length && (name !== "reasoning" || target.end === lines.length)) replacement.push("");
    lines.splice(target.start, target.end - target.start, ...replacement);
    return head + lines.join("\n");
  }

  const trimmed = body.replace(/\n+$/, "");
  const added = block();
  if (!added.length) return normalized;
  return `${head}${trimmed}${trimmed ? "\n\n" : ""}${added.join("\n")}\n`;
}
