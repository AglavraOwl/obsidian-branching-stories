import { describe, expect, it } from "vitest";
import { hashOf, hashText } from "../src/core/hash";
import { cleanSummary, compileOutputs, evaluateSummary, isUsable, summaryMessages } from "../src/core/summary";
import { NodeMeta, TreeIndex } from "../src/core/tree";

describe("hash", () => {
  it("is stable, sensitive and ignores surrounding whitespace in hashOf", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("abc")).toHaveLength(14);
    expect(hashOf("  abc \n")).toBe(hashOf("abc"));
  });
});

describe("summary state", () => {
  const output = "Koss woke at dawn.";
  const summary = "Koss woke.";
  const base = { output, summary, hash: hashOf(output), check: hashOf(summary) };

  it("recognises each state", () => {
    expect(evaluateSummary({ ...base, summary: "" })).toBe("missing");
    expect(evaluateSummary(base)).toBe("valid");
    expect(evaluateSummary({ ...base, output: output + " Then he slept." })).toBe("stale");
    expect(evaluateSummary({ ...base, summary: "Koss woke early." })).toBe("edited");
    expect(evaluateSummary({ output, summary })).toBe("edited"); // written by hand, never by the plugin
    expect(evaluateSummary({ ...base, locked: true, output: "changed" })).toBe("locked");
  });

  it("a hand edit wins over a stale output", () => {
    expect(evaluateSummary({ ...base, summary: "mine", output: "changed" })).toBe("edited");
  });

  it("only valid, locked and edited summaries are usable", () => {
    expect(["missing", "valid", "stale", "locked", "edited"].map((s) => isUsable(s as never))).toEqual([false, true, false, true, true]);
  });
});

describe("summary text helpers", () => {
  it("builds a prompt that carries the passage and asks for 60-120 words", () => {
    const msgs = summaryMessages("The passage.");
    expect(msgs[1].content).toContain("60 to 120 words");
    expect(msgs[1].content).toContain("<passage>\nThe passage.\n</passage>");
  });
  it("cleans chatty preambles", () => {
    expect(cleanSummary("Summary: Koss woke.\n\n\n\nHe slept.")).toBe("Koss woke.\n\nHe slept.");
    expect(cleanSummary("Here is a summary:\nKoss woke.")).toBe("Koss woke.");
  });
  it("joins outputs and skips empty ones", () => {
    expect(compileOutputs(["A", "", "  B  "])).toBe("A\n\n---\n\nB");
  });
});

describe("starred nodes", () => {
  it("lists them per story", () => {
    const t = new TreeIndex();
    const m = (id: string, story: string, starred: boolean): NodeMeta => ({
      id, path: `${story}/${id}.md`, story, parentId: null, regenOf: null, created: id, status: "done", starred, label: "", title: id, model: "",
    });
    t.upsert(m("a", "s1", true));
    t.upsert(m("b", "s1", false));
    t.upsert(m("c", "s2", true));
    expect(t.starredIn("s1").map((n) => n.id)).toEqual(["a"]);
  });
});
