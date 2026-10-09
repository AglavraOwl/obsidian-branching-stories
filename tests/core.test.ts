import { describe, expect, it } from "vitest";
import { idFromLink, makeId, makeTitle, makeUniqueId } from "../src/core/ids";
import { parseBody, replaceSection, serializeNode, splitFrontmatter } from "../src/core/nodeDoc";
import { extractHeadingSection, extractLinks, stripLinks } from "../src/core/links";
import { emitYaml } from "../src/core/yaml";
import { NodeMeta, TreeIndex } from "../src/core/tree";
import { parseStoryBody } from "../src/core/storyDoc";

describe("ids", () => {
  it("formats YYMMDD-HHMM-xx", () => {
    const id = makeId(new Date(2026, 9, 8, 14, 32), () => 0.5);
    expect(id).toBe("261008-1432-ii");
  });
  it("retries on collision", () => {
    let calls = 0;
    const rnd = () => (calls++ < 2 ? 0 : 0.9);
    const id = makeUniqueId(new Date(2026, 9, 8, 14, 32), (x) => x.endsWith("-00"), rnd);
    expect(id.endsWith("-00")).toBe(false);
  });
  it("extracts ids from links and names", () => {
    expect(idFromLink('[[261008-1432-k7 Koss wakes at dawn]]')).toBe("261008-1432-k7");
    expect(idFromLink("[[261008-1432-k7 Koss|alias]]")).toBe("261008-1432-k7");
    expect(idFromLink("Stories/X/nodes/261008-1432-k7 Koss.md")).toBe("261008-1432-k7");
    expect(idFromLink("[[Atka]]")).toBeNull();
    expect(idFromLink("")).toBeNull();
  });
  it("builds safe titles", () => {
    expect(makeTitle("Koss wakes at dawn and sees the [[Atka|healer]] outside")).toBe("Koss wakes at dawn and");
    expect(makeTitle('What: is "this"? * a / test')).toBe("What is this a test");
    expect(makeTitle("   ")).toBe("Untitled");
    expect(makeTitle("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("yaml", () => {
  it("quotes wikilinks, model slugs and empty strings", () => {
    const y = emitYaml({ id: "261008-1432-k7", parent: "[[a b]]", model: "deepseek/deepseek-chat:free", empty: "", n: 0.9, s: { t: 1 } });
    expect(y).toContain('parent: "[[a b]]"');
    expect(y).toContain('model: "deepseek/deepseek-chat:free"');
    expect(y).toContain('empty: ""');
    expect(y).toContain("s:\n  t: 1");
  });
});

describe("node document", () => {
  const fm = { id: "261008-1432-k7", parent: "", created: "2026-10-08T14:32:00", status: "done" as const };
  const sections = { prompt: "Go north.", output: "He went north.\n\n# Heading in prose\n---\nMore.", reasoning: "step 1\n\nstep 2", summary: "", keep: "- scar on left hand" };

  it("round-trips sections", () => {
    const text = serializeNode(fm, sections);
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toContain("id: 261008-1432-k7");
    expect(parseBody(body)).toEqual(sections);
  });

  it("does not let generated text forge section headings", () => {
    const evil = { ...sections, output: "Text\n## Summary\nfake" };
    const parsed = parseBody(splitFrontmatter(serializeNode(fm, evil)).body);
    expect(parsed.summary).toBe("");
    expect(parsed.output).toContain("fake");
  });

  it("replaces one section and leaves the rest alone", () => {
    const text = serializeNode(fm, sections);
    const updated = replaceSection(text, "summary", "Koss travels north.");
    const parsed = parseBody(splitFrontmatter(updated).body);
    expect(parsed.summary).toBe("Koss travels north.");
    expect(parsed.output).toBe(sections.output);
    expect(parsed.keep).toBe(sections.keep);
    expect(parsed.reasoning).toBe(sections.reasoning);
    expect(updated.startsWith(text.slice(0, text.indexOf("## Prompt")))).toBe(true);
  });

  it("adds a missing section and removes reasoning", () => {
    const bare = "---\nid: x\n---\n\n## Prompt\nHi\n\n## Output\nHello\n";
    const withSummary = replaceSection(bare, "summary", "S");
    expect(parseBody(splitFrontmatter(withSummary).body).summary).toBe("S");
    const text = serializeNode(fm, sections);
    const without = replaceSection(text, "reasoning", "");
    expect(parseBody(splitFrontmatter(without).body).reasoning).toBe("");
    expect(parseBody(splitFrontmatter(without).body).summary).toBe("");
  });

  it("tolerates CRLF and hand-edited notes", () => {
    const text = "---\r\nid: x\r\n---\r\n\r\n## Prompt\r\nHi\r\n\r\n## Output\r\nHello\r\n\r\n## Keep in mind\r\n- a\r\n";
    const p = parseBody(splitFrontmatter(text).body);
    expect(p.prompt).toBe("Hi");
    expect(p.output).toBe("Hello");
    expect(p.keep).toBe("- a");
  });
});

describe("links", () => {
  it("extracts, strips and finds sections", () => {
    const t = "Atka meets [[Koss]] and [[Atka#Looks|the healer]] near ![[Map]].";
    const links = extractLinks(t);
    expect(links.map((l) => [l.target, l.heading, l.alias])).toEqual([
      ["Koss", null, null],
      ["Atka", "Looks", "the healer"],
      ["Map", null, null],
    ]);
    expect(stripLinks(t)).toBe("Atka meets Koss and the healer near Map.");
    const note = "# Atka\nintro\n## Looks\ngrey hair\n### Eyes\nblue\n## Past\nold";
    expect(extractHeadingSection(note, "Looks")).toBe("## Looks\ngrey hair\n### Eyes\nblue");
    expect(extractHeadingSection(note, "Nope")).toBeNull();
  });
});

describe("story root", () => {
  it("parses sections", () => {
    const doc = parseStoryBody("# Name\n<!-- c -->\n## System prompt\nBe a writer.\n\n## Lore\nWorld A.\n\n## Pinned details\n- x\n## Other\nignored");
    expect(doc).toEqual({ systemPrompt: "Be a writer.", lore: "World A.", pinned: "- x" });
  });
});

describe("tree index", () => {
  const meta = (id: string, parentId: string | null, created: string, regenOf: string | null = null): NodeMeta => ({
    id,
    path: `s/nodes/${id}.md`,
    story: "s",
    parentId,
    regenOf,
    created,
    status: "done",
    starred: false,
    label: "",
    title: id,
    model: "",
  });

  // root -> a1 (v1) , a2 (v2), a2r (regen of a2) ; a2 -> b1, b2
  const build = (): TreeIndex => {
    const t = new TreeIndex();
    t.upsert(meta("root", null, "1"));
    t.upsert(meta("a1", "root", "2"));
    t.upsert(meta("a2", "root", "3"));
    t.upsert(meta("a2r", "root", "4", "a2"));
    t.upsert(meta("b1", "a2", "5"));
    t.upsert(meta("b2", "a2", "6"));
    t.upsert(meta("c1", "b2", "7"));
    return t;
  };

  it("derives versions and regenerations", () => {
    const t = build();
    const a2 = t.get("s", "a2")!;
    const a2r = t.get("s", "a2r")!;
    expect(t.versionPosition(a2)).toEqual({ index: 2, total: 2 });
    expect(t.versionPosition(a2r)).toEqual({ index: 2, total: 2 });
    expect(t.regenPosition(a2)).toEqual({ index: 1, total: 2 });
    expect(t.regenPosition(a2r)).toEqual({ index: 2, total: 2 });
    expect(t.stepRegen(a2, 1)?.id).toBe("a2r");
    expect(t.stepRegen(a2r, 1)).toBeUndefined();
  });

  it("navigates versions, preferring the branch that was continued", () => {
    const t = build();
    expect(t.stepVersion(t.get("s", "a2r")!, -1)?.id).toBe("a1");
    expect(t.stepVersion(t.get("s", "a1")!, 1)?.id).toBe("a2"); // a2 has the children, a2r none
    t.upsert(meta("x", "a2r", "8"));
    expect(t.stepVersion(t.get("s", "a1")!, 1)?.id).toBe("a2"); // 4 descendants vs 1
  });

  it("builds paths, counts descendants and handles removal/rename", () => {
    const t = build();
    expect(t.pathTo(t.get("s", "c1")!).map((n) => n.id)).toEqual(["root", "a2", "b2", "c1"]);
    expect(t.descendantCount(t.get("s", "a2")!)).toBe(3);
    expect(t.childrenOf(t.get("s", "a2")!).map((n) => n.id)).toEqual(["b1", "b2"]);
    t.renamePath("s/nodes/b1.md", "s/nodes/b1 renamed.md");
    expect(t.getByPath("s/nodes/b1 renamed.md")?.id).toBe("b1");
    t.removePath("s/nodes/b2.md");
    expect(t.childrenOf(t.get("s", "a2")!).map((n) => n.id)).toEqual(["b1"]);
  });

  it("survives a missing parent and cycles", () => {
    const t = new TreeIndex();
    t.upsert(meta("orphan", "ghost", "1"));
    expect(t.pathTo(t.get("s", "orphan")!).map((n) => n.id)).toEqual(["orphan"]);
    t.upsert(meta("p", "q", "1"));
    t.upsert(meta("q", "p", "2"));
    expect(t.pathTo(t.get("s", "p")!).length).toBe(2);
  });
});
