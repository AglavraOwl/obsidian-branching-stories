const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_PREFIX_RE = /^(\d{6}-\d{4}-[0-9a-z]{2})(?=\s|$)/;
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYMMDD-HHMM-xx`, local time, `xx` = two random base-36 characters. */
export function makeId(now: Date, random: () => number = Math.random): string {
  const date = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const suffix = BASE36[Math.floor(random() * 36)] + BASE36[Math.floor(random() * 36)];
  return `${date}-${time}-${suffix}`;
}

/** An id that is not in `taken`, retrying the random suffix on collision. */
export function makeUniqueId(now: Date, taken: (id: string) => boolean, random: () => number = Math.random): string {
  for (let i = 0; i < 200; i++) {
    const id = makeId(now, random);
    if (!taken(id)) return id;
  }
  // Practically unreachable (1296 suffixes per minute); fall back to seconds precision.
  return `${makeId(now, random)}${pad(now.getSeconds())}`;
}

/** Local-time timestamp used for the `created` field: `YYYY-MM-DDTHH:mm:ss`. */
export function makeTimestamp(now: Date): string {
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/**
 * Extract the node id from a wikilink such as `[[261008-1432-k7 Koss wakes]]`,
 * `[[id title|alias]]` or from a bare file name / basename. Returns null if none.
 */
export function idFromLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  let s = link.trim();
  const wiki = s.match(/^!?\[\[([\s\S]*?)\]\]$/);
  if (wiki) s = wiki[1];
  s = s.split("|")[0].split("#")[0].trim();
  s = s.replace(/^.*\//, "").replace(/\.md$/i, "");
  const m = s.match(ID_PREFIX_RE);
  return m ? m[1] : null;
}

export function idFromBasename(basename: string): string | null {
  return idFromLink(basename);
}

/** First ~5 words of the prompt, filename-safe, capped at 60 characters. */
export function makeTitle(prompt: string, maxWords = 5, maxLength = 60): string {
  const text = prompt
    .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias || target)
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Untitled";
  let title = text.split(" ").slice(0, maxWords).join(" ");
  if (title.length > maxLength) title = title.slice(0, maxLength).trim();
  title = title.replace(/[. ]+$/, "");
  return title || "Untitled";
}

export function makeFileName(id: string, title: string): string {
  return `${id} ${title}.md`;
}

export function makeWikilink(basename: string): string {
  return `[[${basename}]]`;
}
