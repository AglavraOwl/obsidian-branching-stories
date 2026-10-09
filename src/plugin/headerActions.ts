import { MarkdownView } from "obsidian";
import { toggleStar } from "./actions";
import { editAndRegenerate, newNode, regenerate, whereAmI } from "./commands";
import type BranchingStoriesPlugin from "./main";

type Kind = "node" | "root" | "none";

interface Attached {
  kind: Kind;
  elements: HTMLElement[];
  star?: HTMLElement;
  stop?: HTMLElement;
}

/** Buttons in the note header (view actions) for the main commands. */
export class HeaderActions {
  private attached = new WeakMap<MarkdownView, Attached>();

  constructor(private plugin: BranchingStoriesPlugin) {}

  syncAll(): void {
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) this.sync(leaf.view);
    });
  }

  private sync(view: MarkdownView): void {
    const { plugin } = this;
    const file = view.file;
    const meta = file ? plugin.store.nodeOf(file) : undefined;
    const kind: Kind = meta ? "node" : file && plugin.store.isStoryRoot(file) ? "root" : "none";

    let current = this.attached.get(view);
    if (current && current.kind !== kind) {
      current.elements.forEach((el) => el.detach());
      current = undefined;
      this.attached.delete(view);
    }
    if (!current) {
      current = { kind, elements: [] };
      this.attached.set(view, current);
      if (kind !== "none") this.build(view, current);
    }

    if (meta && current.star) {
      current.star.toggleClass("bs-starred", meta.starred);
      current.star.setAttribute("aria-label", meta.starred ? "Remove star" : "Star this node");
    }
    if (current.stop) {
      const running = !!meta && plugin.generation.isGenerating(meta);
      current.stop.toggleClass("bs-hidden", !running);
    }
  }

  private build(view: MarkdownView, att: Attached): void {
    const { plugin } = this;
    const here = () => {
      const w = whereAmI(plugin);
      if (!w) throw new Error("Open a story note first.");
      return w;
    };
    const add = (icon: string, title: string, fn: () => Promise<void>): HTMLElement => {
      const el = view.addAction(icon, title, () => {
        fn().catch((e) => plugin.generation.report(e));
      });
      att.elements.push(el);
      return el;
    };

    // addAction puts new buttons to the left of earlier ones, so add in reverse reading order.
    if (att.kind === "node") {
      att.star = add("star", "Star this node", async () => {
        const w = here();
        if (w.node) await toggleStar(plugin, w.node);
      });
      att.stop = add("square", "Stop generation", async () => {
        const w = here();
        if (w.node) plugin.generation.stop(w.node);
      });
      add("pencil", "Edit prompt and regenerate", async () => {
        const w = here();
        if (w.node) await editAndRegenerate(plugin, w.node);
      });
      add("refresh-cw", "Regenerate", async () => {
        const w = here();
        if (w.node) await regenerate(plugin, w.node);
      });
    }
    add("plus", att.kind === "node" ? "New node from here" : "Write the first node", async () => newNode(plugin, here()));
  }
}

