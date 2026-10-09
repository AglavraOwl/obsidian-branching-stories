import { StateEffect, StateField, EditorState, Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField, MarkdownPostProcessorContext, MarkdownView, setIcon } from "obsidian";
import { NodeMeta } from "../core/tree";
import { goDown, goStep, goUp, nodeInfo, pickRegen, pickVersion, toggleStar } from "./actions";
import type BranchingStoriesPlugin from "./main";

const GROUP_STYLE = { display: "inline-flex", "flex-direction": "row", "flex-wrap": "nowrap", "align-items": "center" };

function forceStyle(el: HTMLElement, styles: Record<string, string>): void {
  for (const [prop, value] of Object.entries(styles)) el.style.setProperty(prop, value, "important");
}

/** A small bar of plain DOM, drawn by the plugin and never stored in the note. */
export function buildNavBar(plugin: BranchingStoriesPlugin, meta: NodeMeta): HTMLElement {
  const info = nodeInfo(plugin, meta);
  const bar = document.createElement("div");
  bar.className = "bs-navbar";
  // The editor applies its own rules to widget contents, so set the layout inline as well.
  forceStyle(bar, { display: "flex", "flex-direction": "row", "flex-wrap": "wrap", "align-items": "center" });

  const run = (fn: () => Promise<void>) => (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    fn().catch((e) => plugin.generation.report(e));
  };

  const button = (parent: HTMLElement, icon: string | null, text: string, title: string, enabled: boolean, fn: () => Promise<void>): HTMLButtonElement => {
    const b = parent.createEl("button", { cls: "bs-nav-btn", attr: { type: "button", "aria-label": title, title } });
    forceStyle(b, { display: "inline-flex", "flex-direction": "row", "align-items": "center", width: "auto", margin: "0" });
    if (icon) setIcon(b.createSpan({ cls: "bs-nav-icon" }), icon);
    if (text) b.createSpan({ text, cls: "bs-nav-text" });
    b.disabled = !enabled;
    b.addEventListener("click", run(fn));
    // keep the editor from taking focus / starting a selection
    b.addEventListener("mousedown", (ev) => ev.preventDefault());
    return b;
  };

  button(bar, "arrow-up", "", "Parent (or story note)", true, () => goUp(plugin, meta));

  const versions = bar.createDiv({ cls: "bs-nav-group" });
  forceStyle(versions, GROUP_STYLE);
  button(versions, "chevron-left", "", "Previous prompt version", info.version.index > 1, () => goStep(plugin, meta, "version", -1));
  button(versions, null, `Version ${info.version.index} of ${info.version.total}`, "Choose a prompt version", info.version.total > 1, () => pickVersion(plugin, meta)).addClass("bs-nav-label");
  button(versions, "chevron-right", "", "Next prompt version", info.version.index < info.version.total, () => goStep(plugin, meta, "version", 1));

  const regens = bar.createDiv({ cls: "bs-nav-group" });
  forceStyle(regens, GROUP_STYLE);
  button(regens, "chevron-left", "", "Previous regeneration", info.regen.index > 1, () => goStep(plugin, meta, "regen", -1));
  button(regens, null, `Regeneration ${info.regen.index} of ${info.regen.total}`, "Choose a regeneration", info.regen.total > 1, () => pickRegen(plugin, meta)).addClass("bs-nav-label");
  button(regens, "chevron-right", "", "Next regeneration", info.regen.index < info.regen.total, () => goStep(plugin, meta, "regen", 1));

  button(bar, "arrow-down", info.children ? String(info.children) : "", info.children ? "Continue to a child" : "No children yet", info.children > 0, () => goDown(plugin, meta, meta.story));

  const star = button(bar, "star", "", meta.starred ? "Remove star" : "Star this node", true, () => toggleStar(plugin, meta));
  if (meta.starred) star.addClass("bs-starred");

  if (meta.label) bar.createSpan({ text: meta.label, cls: "bs-nav-chip" });
  if (meta.status !== "done") bar.createSpan({ text: meta.status, cls: `bs-nav-chip bs-status-${meta.status}` });
  return bar;
}

function signature(plugin: BranchingStoriesPlugin, meta: NodeMeta): string {
  const info = nodeInfo(plugin, meta);
  return JSON.stringify([info.version, info.regen, info.children, meta.starred, meta.label, meta.status]);
}

/** Position right after the frontmatter block (or 0 when there is none). */
function bodyStart(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    if (doc.line(n).text.trim() === "---") return doc.line(n).to;
  }
  return 0;
}

class NavWidget extends WidgetType {
  constructor(private plugin: BranchingStoriesPlugin, private path: string, private sig: string) {
    super();
  }

  eq(other: NavWidget): boolean {
    return other.path === this.path && other.sig === this.sig;
  }

  toDOM(): HTMLElement {
    const meta = this.plugin.store.index.getByPath(this.path);
    return meta ? buildNavBar(this.plugin, meta) : document.createElement("div");
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const refreshEffect = StateEffect.define<null>();

/** Live Preview and Source mode: a block widget right under the properties. */
export function navBarExtension(plugin: BranchingStoriesPlugin): Extension {
  const build = (state: EditorState): DecorationSet => {
    const file = state.field(editorInfoField, false)?.file;
    const meta = file ? plugin.store.index.getByPath(file.path) : undefined;
    if (!meta) return Decoration.none;
    const widget = new NavWidget(plugin, meta.path, signature(plugin, meta));
    return Decoration.set([Decoration.widget({ widget, block: true, side: 1 }).range(bodyStart(state))]);
  };

  return StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((e) => e.is(refreshEffect))) return build(tr.state);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** Re-evaluate the bar in every open note (after the index changed). */
export function refreshNavBars(plugin: BranchingStoriesPlugin): void {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (cm) cm.dispatch({ effects: refreshEffect.of(null) });
    if (view.getMode() === "preview" && view.file && plugin.store.index.getByPath(view.file.path)) {
      view.previewMode.rerender(true);
    }
  });
}

/** Reading view: put the bar into the first rendered section of a node note. */
export function navBarPostProcessor(plugin: BranchingStoriesPlugin) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const meta = plugin.store.index.getByPath(ctx.sourcePath);
    if (!meta) return;
    const section = ctx.getSectionInfo(el);
    if (!section) return;
    const lines = section.text.split("\n");
    let first = 0;
    if (lines[0]?.trim() === "---") {
      const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
      if (end > 0) first = end + 1;
    }
    while (first < lines.length && !lines[first].trim()) first++;
    // The properties block is a section too (it starts at line 0): only the first real section gets the bar.
    if (section.lineStart !== first || el.querySelector(":scope > .bs-navbar")) return;
    el.prepend(buildNavBar(plugin, meta));
  };
}
