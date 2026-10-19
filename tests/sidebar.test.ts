// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { NodeMeta, TreeIndex } from "../src/core/tree";

type Opts = { text?: string; cls?: string; attr?: Record<string, string>; type?: string; href?: string };

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.empty = function (this: HTMLElement) {
    this.innerHTML = "";
  };
  proto.addClass = function (this: HTMLElement, c: string) {
    this.classList.add(c);
  };
  proto.setText = function (this: HTMLElement, t: string) {
    this.textContent = t;
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

const meta = (id: string, parentId: string | null, created: string, extra: Partial<NodeMeta> = {}): NodeMeta => ({
  id,
  path: `Stories/S/nodes/${id}.md`,
  story: "Stories/S",
  parentId,
  regenOf: null,
  created,
  status: "done",
  starred: false,
  label: "",
  title: `Title ${id}`,
  model: "m",
  ...extra,
});

describe("story sidebar", () => {
  it("does not replace any method Obsidian's panel base class uses itself", async () => {
    const { StorySidebar } = await import("../src/plugin/sidebar");
    // `open` was once defined here by accident; Obsidian calls it with the panel container,
    // so overriding it left the panel blank. These are the base-class names to keep clear of.
    const reserved = ["open", "close", "load", "unload", "onload", "onunload", "setState", "getState", "onResize", "focus", "addAction"];
    const own = Object.getOwnPropertyNames(StorySidebar.prototype);
    expect(own.filter((name) => reserved.includes(name))).toEqual([]);
  });

  it("renders the path, what continues, and bookmarks", async () => {
    const { StorySidebar } = await import("../src/plugin/sidebar");
    const index = new TreeIndex();
    index.upsert(meta("n1", null, "01"));
    index.upsert(meta("n2", "n1", "02"));
    index.upsert(meta("n3", "n2", "03", { starred: true, label: "Koss recovers" }));
    index.upsert(meta("n3b", "n2", "04"));

    const file = { path: "Stories/S/nodes/n2.md" };
    const plugin = {
      settings: { bookmarkSort: "created" },
      saveSettings: async () => undefined,
      statusOf: (m: NodeMeta) => m.status,
      generation: { report: () => undefined },
      store: {
        index,
        onChange: () => () => undefined,
        nodeOf: () => index.get("Stories/S", "n2"),
        isStoryRoot: () => false,
        fileFor: () => file,
      },
    };
    const view = new StorySidebar({} as never, plugin as never) as unknown as {
      app: { workspace: { getActiveFile: () => unknown }; vault: { getMarkdownFiles: () => unknown[] } };
      contentEl: HTMLElement;
      onOpen: () => Promise<void>;
    };
    view.app.workspace.getActiveFile = () => file;
    view.app.vault.getMarkdownFiles = () => ["n1", "n2", "n3", "n3b"].map((id) => ({ path: `Stories/S/nodes/${id}.md` }));
    await view.onOpen();

    const text = view.contentEl.textContent ?? "";
    expect(text).toContain("S"); // story name
    expect(text).toContain("Path");
    expect(text).toContain("Title n1");
    expect(text).toContain("Title n2");
    expect(text).toContain("Continues with");
    expect(text).toContain("Koss recovers");
    expect(view.contentEl.querySelectorAll(".bs-side-row").length).toBeGreaterThanOrEqual(5);
    expect(view.contentEl.querySelectorAll(".bs-side-tab").length).toBeGreaterThan(0);
    expect(text).toContain("4 nodes in this story");
  });

  it("explains itself instead of staying blank when drawing fails", async () => {
    const { StorySidebar } = await import("../src/plugin/sidebar");
    const index = new TreeIndex();
    index.upsert(meta("n1", null, "01"));
    const file = { path: "Stories/S/nodes/n1.md" };
    const plugin = {
      settings: { bookmarkSort: "created" },
      statusOf: () => "done",
      generation: { report: () => undefined },
      store: { index, onChange: () => () => undefined, nodeOf: () => index.get("Stories/S", "n1"), isStoryRoot: () => false },
    };
    const view = new StorySidebar({} as never, plugin as never) as unknown as {
      app: { workspace: { getActiveFile: () => unknown }; vault: { getMarkdownFiles: () => unknown[] } };
      contentEl: HTMLElement;
      onOpen: () => Promise<void>;
    };
    view.app.workspace.getActiveFile = () => file;
    view.app.vault.getMarkdownFiles = () => {
      throw new Error("vault is not ready");
    };
    await view.onOpen();
    expect(view.contentEl.textContent).toContain("The sidebar could not be drawn.");
    expect(view.contentEl.textContent).toContain("vault is not ready");
  });
});
