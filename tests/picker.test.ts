// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

type Opts = { text?: string; cls?: string; attr?: Record<string, string> };

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.addClass = function (this: HTMLElement, c: string) {
    this.classList.add(c);
  };
  proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) {
    this.classList.toggle(c, on);
  };
  proto.createEl = function (this: HTMLElement, tag: string, o: Opts = {}) {
    const el = document.createElement(tag);
    if (o.text) el.textContent = o.text;
    if (o.cls) el.className = o.cls;
    for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (this: HTMLElement, o: Opts = {}) {
    return (this as unknown as { createEl: (t: string, o: Opts) => HTMLElement }).createEl("div", o);
  };
  proto.createSpan = function (this: HTMLElement, o: Opts = {}) {
    return (this as unknown as { createEl: (t: string, o: Opts) => HTMLElement }).createEl("span", o);
  };
});

const SLUG = "google/gemini-3.5-flash-lite";

describe("model picker rows", () => {
  it("keeps the highlighted pieces of the name together, with the star beside them", async () => {
    // The name is drawn as several pieces. A row laid out as a flex row with a gap spread every
    // piece apart (0.3.6), so the pieces must live in one box and the row must hold only that box and the star.
    const { ChoiceModal } = await import("../src/plugin/modals");
    const starred = new Set<string>();
    const modal = new ChoiceModal<string>(null as never, [SLUG], (id) => id, "Search", {
      isStarred: (id) => starred.has(id),
      toggle: async (id) => void starred.add(id),
    });
    const row = document.createElement("div");
    modal.renderSuggestion({ item: SLUG, match: { score: 0, matches: [] } }, row);

    expect(row.classList.contains("bs-star-row")).toBe(true);
    expect(Array.from(row.children).map((c) => c.className)).toEqual(["bs-star-label", "bs-star-btn"]);
    const label = row.querySelector(".bs-star-label")!;
    expect(label.textContent).toBe(SLUG);
    expect(label.querySelectorAll(".suggestion-highlight").length).toBeGreaterThan(0);
  });

  it("toggles the star without choosing the row", async () => {
    const { ChoiceModal } = await import("../src/plugin/modals");
    const starred = new Set<string>();
    const modal = new ChoiceModal<string>(null as never, [SLUG], (id) => id, "Search", {
      isStarred: (id) => starred.has(id),
      toggle: async (id) => void starred.add(id),
    });
    const row = document.createElement("div");
    modal.renderSuggestion({ item: SLUG, match: { score: 0, matches: [] } }, row);

    let rowClicked = false;
    row.addEventListener("click", () => (rowClicked = true));
    const btn = row.querySelector(".bs-star-btn") as HTMLElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(rowClicked).toBe(false);
    expect(starred.has(SLUG)).toBe(true);
    expect(btn.classList.contains("is-starred")).toBe(true);
  });

  it("draws plain rows as before when there is no star", async () => {
    const { ChoiceModal } = await import("../src/plugin/modals");
    const modal = new ChoiceModal<string>(null as never, [SLUG], (id) => id, "Search");
    const row = document.createElement("div");
    modal.renderSuggestion({ item: SLUG, match: { score: 0, matches: [] } }, row);
    expect(row.querySelector(".bs-star-label")).toBeNull();
    expect(row.textContent).toBe(SLUG);
  });
});
