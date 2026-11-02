import { describe, expect, it } from "vitest";
import { fmtCost, nodeCost, pathCost, roundCost, storyCost } from "../src/core/cost";
import { NodeMeta } from "../src/core/tree";

const node = (id: string, extra: Partial<NodeMeta> = {}): NodeMeta => ({
  id,
  path: `S/nodes/${id}.md`,
  story: "S",
  parentId: null,
  regenOf: null,
  created: "2026-11-02T10:00:00",
  status: "done",
  starred: false,
  label: "",
  title: id,
  model: "a/main",
  ...extra,
});

describe("fmtCost", () => {
  it("keeps enough digits for small amounts", () => {
    expect(fmtCost(0)).toBe("$0");
    expect(fmtCost(0.0042)).toBe("$0.0042");
    expect(fmtCost(0.0250425)).toBe("$0.025");
    expect(fmtCost(1.2)).toBe("$1.20");
  });

  it("shows nothing negative or broken", () => {
    expect(fmtCost(NaN)).toBe("$0");
    expect(fmtCost(-1)).toBe("$0");
  });
});

describe("costs of nodes and paths", () => {
  it("adds generation and summaries, treating unknown as nothing", () => {
    expect(nodeCost(node("a", { cost: 0.02, summaryCost: 0.005 }))).toBeCloseTo(0.025);
    expect(nodeCost(node("b"))).toBe(0);
  });

  it("sums a path without float noise", () => {
    expect(pathCost([node("a", { cost: 0.1 }), node("b", { cost: 0.2 })])).toBe(0.3);
    expect(roundCost(0.1 + 0.2)).toBe(0.3);
  });
});

describe("story cost", () => {
  const nodes = [
    node("a", { cost: 0.02, summaryCost: 0.002, model: "a/main" }),
    node("b", { cost: 0.03, model: "a/main" }),
    node("c", { cost: 0.01, model: "b/cheap" }),
    node("d", { model: "local" }), // no cost recorded (stopped, failed or LM Studio)
  ];

  it("totals generation, summaries and tagging", () => {
    const s = storyCost(nodes, 0.001);
    expect(s.generation).toBe(0.06);
    expect(s.summaries).toBe(0.002);
    expect(s.tagging).toBe(0.001);
    expect(s.total).toBe(0.063);
  });

  it("counts nodes with and without a recorded cost", () => {
    const s = storyCost(nodes, 0);
    expect(s.nodesWithCost).toBe(3);
    expect(s.nodesWithoutCost).toBe(1);
  });

  it("lists the models, most expensive first, with their node counts", () => {
    expect(storyCost(nodes, 0).byModel).toEqual([
      { model: "a/main", nodes: 2, cost: 0.05 },
      { model: "b/cheap", nodes: 1, cost: 0.01 },
    ]);
  });

  it("copes with an empty story", () => {
    const s = storyCost([], 0);
    expect(s.total).toBe(0);
    expect(s.byModel).toEqual([]);
  });
});
