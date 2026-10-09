/** Wikilink handling for prompts, lore and "keep in mind" text. */

export interface WikiLink {
  /** Note name as typed, without heading/alias, e.g. `Atka`. */
  target: string;
  /** Heading after `#`, if any. */
  heading: string | null;
  alias: string | null;
  /** Original text including brackets. */
  raw: string;
}

const LINK_RE = /!?\[\[([^\]|#]*?)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;

export function extractLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({ target, heading: m[2]?.trim() || null, alias: m[3]?.trim() || null, raw: m[0] });
  }
  return out;
}

/** Turn `[[Atka|the healer]]` into `the healer` and `[[Atka#Looks]]` into `Atka`. */
export function stripLinks(text: string): string {
  return text.replace(LINK_RE, (_m, target: string, _heading: string | undefined, alias: string | undefined) =>
    (alias ?? target).trim(),
  );
}

/** Stable key so the same note/section is only included once. */
export function linkKey(link: WikiLink): string {
  return `${link.target.toLowerCase()}#${(link.heading ?? "").toLowerCase()}`;
}

export function uniqueLinks(links: WikiLink[]): WikiLink[] {
  const seen = new Set<string>();
  const out: WikiLink[] = [];
  for (const l of links) {
    const k = linkKey(l);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(l);
    }
  }
  return out;
}

/** Drop the frontmatter block of a linked note. */
export function stripFrontmatter(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "");
}

/** Return the part of a note under `heading` (until the next heading of same or higher level). */
export function extractHeadingSection(text: string, heading: string): string | null {
  const lines = text.split("\n");
  const wanted = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    if (start === -1) {
      if (m[2].trim().toLowerCase() === wanted) {
        start = i;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

/** Remove top-level properties (and their indented / list continuation lines) from a YAML block. */
export function filterFrontmatterKeys(frontmatter: string, ignore: string[]): string {
  const skip = new Set(ignore.map((k) => k.trim().toLowerCase()).filter(Boolean));
  if (!skip.size) return frontmatter;
  const out: string[] = [];
  let skipping = false;
  for (const line of frontmatter.split("\n")) {
    const top = line.match(/^([^\s#:-][^:]*?|"[^"]*"|'[^']*')\s*:/);
    if (top) skipping = skip.has(top[1].replace(/^["']|["']$/g, "").trim().toLowerCase());
    else if (skipping && line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("- ")) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

export interface NoteTextOptions {
  heading: string | null;
  includeFrontmatter: boolean;
  ignoreKeys: string[];
}

/**
 * What a linked note contributes to the context: the properties (as YAML) followed by the body,
 * or just the requested section when the link points at a heading.
 */
export function noteTextForContext(raw: string, opts: NoteTextOptions): string | null {
  const text = raw.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  const body = m ? text.slice(m[0].length) : text;
  if (opts.heading) return extractHeadingSection(body, opts.heading);
  const props = m && opts.includeFrontmatter ? filterFrontmatterKeys(m[1], opts.ignoreKeys).trim() : "";
  return props ? `---\n${props}\n---\n\n${body.trim()}`.trim() : body.trim();
}
