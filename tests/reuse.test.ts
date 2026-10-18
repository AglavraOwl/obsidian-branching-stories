import { describe, expect, it } from "vitest";
import { continuationSources, dedupeByText, versionSources } from "../src/core/reuse";
import { NodeMeta, TreeIndex } from "../src/core/tree";

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

// 1 ─ 2 ─ 3 (+ regen 3r)       the original run
// 1 ─ 2b                       the edited prompt of turn 2 (a sibling of 2)
// 2 ─ 3b                       a second continuation of 2
const build = (): TreeIndex => {
  const t = new TreeIndex();
  t.upsert(meta("n1", null, "01"));
  t.upsert(meta("n2", "n1", "02"));
  t.upsert(meta("n3", "n2", "03"));
  t.upsert(meta("n3r", "n2", "04", "n3"));
  t.upsert(meta("n2b", "n1", "05"));
  t.upsert(meta("n3b", "n2", "06"));
  return t;
};

describe("continuation sources", () => {
  it("from the edited version, offers the continuations of the original version (your case)", () => {
    const t = build();
    const sources = continuationSources(t, "s", t.get("s", "n2b")!);
    expect(sources.map((s) => [s.node.id, s.origin, s.fromVersion])).toEqual([
      ["n3b", "other-version", 1],
      ["n3", "other-version", 1], // the regeneration n3r shares n3's prompt and is not listed again
    ]);
  });

  it("from the original version, lists existing children first-class and nothing from itself twice", () => {
    const t = build();
    const sources = continuationSources(t, "s", t.get("s", "n2")!);
    expect(sources.map((s) => [s.node.id, s.origin])).toEqual([
      ["n3b", "continuation"],
      ["n3", "continuation"],
    ]);
  });

  it("works from a regeneration of the parent and for the first node", () => {
    const t = build();
    t.upsert(meta("n2r", "n1", "07", "n2"));
    // n2r is a regeneration of n2: same version, so the children of n2 are its continuations
    expect(continuationSources(t, "s", t.get("s", "n2r")!).map((s) => s.origin)).not.toContain("other-version");
    // first node of the story: other first prompts
    expect(continuationSources(t, "s", null).map((s) => s.node.id)).toEqual(["n1"]);
  });

  it("returns nothing when there is nothing to reuse", () => {
    const t = new TreeIndex();
    t.upsert(meta("a", null, "01"));
    expect(continuationSources(t, "s", t.get("s", "a")!)).toEqual([]);
  });
});

describe("version sources", () => {
  it("lists the other prompt versions of the turn", () => {
    const t = build();
    expect(versionSources(t, t.get("s", "n2b")!).map((s) => [s.node.id, s.fromVersion])).toEqual([["n2", 1]]);
    expect(versionSources(t, t.get("s", "n2")!).map((s) => s.node.id)).toEqual(["n2b"]);
  });
});

describe("dedupe", () => {
  it("keeps the first of identical prompts, ignoring spacing and case", () => {
    const items = [{ text: "Go  north." }, { text: "go north." }, { text: "Go south." }, { text: "  " }];
    expect(dedupeByText(items).map((i) => i.text)).toEqual(["Go  north.", "Go south."]);
  });
});
