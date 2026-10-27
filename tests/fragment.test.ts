import { describe, expect, it } from "vitest";
import {
  allBaseText,
  fragmentFileName,
  locatePassage,
  normalizeTags,
  parseTagList,
  parseTagReply,
  serializeFragment,
  storyBaseText,
  tagMessages,
} from "../src/core/fragment";
import { splitFrontmatter } from "../src/core/nodeDoc";

const when = new Date(2026, 9, 27, 14, 5, 9);

describe("fragment file", () => {
  it("is named by date, time and the first words", () => {
    expect(fragmentFileName(when, "The cart lurched and the smell of tar came up, thick as soup.")).toBe(
      "2026-10-27 1405 The cart lurched and the smell.md",
    );
  });

  it("keeps the passage plain and the properties readable", () => {
    const text = serializeFragment(
      { story: "Road Story", source: "[[261027-1405-ab Wagon]]", section: "output", created: when, tags: ["sensory", "description"] },
      "  The cart lurched.\n\nHe gagged.  ",
    );
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toContain("type: fragment");
    expect(frontmatter).toContain('source: "[[261027-1405-ab Wagon]]"');
    expect(frontmatter).toContain("created: 2026-10-27T14:05:09");
    expect(frontmatter).toContain("  - sensory");
    expect(body.trim()).toBe("The cart lurched.\n\nHe gagged.");
  });

  it("writes an empty tag list and leaves out an unknown section", () => {
    const text = serializeFragment({ story: "S", source: "[[n]]", created: when, tags: [] }, "x");
    expect(text).toContain("tags: []");
    expect(text).not.toContain("section");
  });
});

describe("locatePassage", () => {
  const sections = { prompt: "Describe the wagon.", output: "First para.\n\nThe cart lurched and the tar smell rose.\nHe gagged.\n\nLast." };

  it("finds the section and the paragraph around the selection", () => {
    const r = locatePassage("the tar smell rose.", sections);
    expect(r.section).toBe("output");
    expect(r.context).toBe("The cart lurched and the tar smell rose.\nHe gagged.");
  });

  it("finds a passage in the prompt", () => {
    expect(locatePassage("Describe the wagon", sections).section).toBe("prompt");
  });

  it("falls back to the passage itself when it is not found", () => {
    const r = locatePassage("something rendered differently", sections);
    expect(r.section).toBeUndefined();
    expect(r.context).toBe("something rendered differently");
  });

  it("uses the passage when it spans more than the paragraph", () => {
    const r = locatePassage("First para.\n\nThe cart lurched", sections);
    expect(r.section).toBe("output");
    expect(r.context).toBe("First para.\n\nThe cart lurched");
  });
});

describe("tags", () => {
  it("normalizes", () => {
    expect(normalizeTags(["#Sensory", "sensory", " Dark Humor ", "", "a/b"])).toEqual(["sensory", "dark-humor", "a/b"]);
  });

  it("reads the vocabulary from the settings text", () => {
    expect(parseTagList("description, Dialogue\nemotion,, ")).toEqual(["description", "dialogue", "emotion"]);
  });

  const vocab = ["description", "emotion", "sensory"];

  it("parses a JSON reply, also inside a code fence", () => {
    expect(parseTagReply('```json\n["Sensory", "description"]\n```', vocab)).toEqual(["sensory", "description"]);
  });

  it("keeps at most one tag that is not on the list, after the listed ones", () => {
    expect(parseTagReply('["nausea","emotion","smell"]', vocab)).toEqual(["emotion", "nausea"]);
  });

  it("falls back to a plain list", () => {
    expect(parseTagReply("sensory, emotion", vocab)).toEqual(["sensory", "emotion"]);
  });

  it("accepts anything when there is no vocabulary", () => {
    expect(parseTagReply('["a","b","c"]', [])).toEqual(["a", "b", "c"]);
  });

  it("gives nothing for an empty reply", () => {
    expect(parseTagReply("", vocab)).toEqual([]);
  });

  it("shows the model the vocabulary and the surrounding paragraph", () => {
    const m = tagMessages("short bit", "short bit in a longer paragraph", vocab);
    expect(m[1].content).toContain("description, emotion, sensory");
    expect(m[1].content).toContain("<context>");
    expect(tagMessages("same", "same", vocab)[1].content).not.toContain("<context>");
  });
});

describe("base files", () => {
  it("filters a story table by its folder", () => {
    const t = storyBaseText("Stories/Road's End/Fragments");
    expect(t).toContain(`- 'file.inFolder("Stories/Road''s End/Fragments")'`);
    expect(t).toContain("type: table");
  });

  it("filters the combined table by the fragment type", () => {
    expect(allBaseText()).toContain(`- 'type == "fragment"'`);
  });
});
