import { describe, expect, it } from "vitest";
import { applyOverride, chipModels, toggleFavorite } from "../src/core/modelChoice";

const base = { provider: "openrouter" as "openrouter" | "lmstudio", model: "a/main", reasoning: false, temperature: 1 };

describe("applyOverride", () => {
  it("keeps the configuration without an override", () => {
    expect(applyOverride(base, undefined)).toBe(base);
  });

  it("switches the model and thinking for one generation without touching the rest", () => {
    const c = applyOverride(base, { model: "b/other", reasoning: true });
    expect(c).toEqual({ ...base, model: "b/other", reasoning: true });
    expect(base.model).toBe("a/main");
  });

  it("takes the provider along with a recorded model (regenerate)", () => {
    const c = applyOverride(base, { provider: "lmstudio", model: "local-x" });
    expect(c.provider).toBe("lmstudio");
    expect(c.model).toBe("local-x");
    expect(c.reasoning).toBe(false);
  });

  it("ignores an empty model but still applies thinking", () => {
    const c = applyOverride(base, { provider: "lmstudio", model: "  ", reasoning: true });
    expect(c.provider).toBe("openrouter");
    expect(c.model).toBe("a/main");
    expect(c.reasoning).toBe(true);
  });
});

describe("chipModels", () => {
  it("lists the starred models", () => {
    expect(chipModels(["x/1", "x/2"], "x/2")).toEqual(["x/1", "x/2"]);
  });

  it("puts the model in effect first when it is not starred", () => {
    expect(chipModels(["x/1"], "y/9")).toEqual(["y/9", "x/1"]);
  });

  it("copes with nothing starred and no model", () => {
    expect(chipModels([], "")).toEqual([]);
    expect(chipModels(["x/1", "x/1"], "")).toEqual(["x/1"]);
  });
});

describe("toggleFavorite", () => {
  it("adds and removes", () => {
    expect(toggleFavorite(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFavorite(["a", "b"], "a")).toEqual(["b"]);
  });
});
