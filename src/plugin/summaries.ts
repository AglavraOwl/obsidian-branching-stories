import { Notice, TFile } from "obsidian";
import { chatCompletion, ProviderError, ProviderKind } from "../api/client";
import { hashOf } from "../core/hash";
import { parseNodeText, replaceSection } from "../core/nodeDoc";
import { cleanSummary, evaluateSummary, SummaryState, summaryMessages } from "../core/summary";
import { NodeMeta } from "../core/tree";
import type BranchingStoriesPlugin from "./main";
import { ProgressModal } from "./modals";

export class SummaryCancelled extends Error {
  constructor() {
    super("Summarizing was cancelled.");
    this.name = "SummaryCancelled";
  }
}

export interface SummaryModel {
  provider: ProviderKind;
  model: string;
}

export interface NodeSummary {
  state: SummaryState;
  text: string;
  output: string;
}

const SUMMARY_TEMPERATURE = 0.3;
const SUMMARY_MAX_TOKENS = 1500;

export class SummaryService {
  constructor(private plugin: BranchingStoriesPlugin) {}

  private get app() {
    return this.plugin.app;
  }

  /** Provider and model used for summaries, given the generation settings in effect. */
  modelFor(generation: SummaryModel): SummaryModel {
    const s = this.plugin.settings.summary;
    return s.useGenerationModel
      ? { provider: generation.provider, model: generation.model }
      : { provider: s.provider, model: s.model };
  }

  /** Current state of a node's summary. */
  async inspect(meta: NodeMeta): Promise<NodeSummary> {
    const loaded = await this.plugin.store.loadMeta(meta);
    if (!loaded) return { state: "missing", text: "", output: "" };
    const fm = loaded.frontmatter;
    const state = evaluateSummary({
      output: loaded.sections.output,
      summary: loaded.sections.summary,
      hash: fm.summary_hash,
      check: fm.summary_check,
      locked: fm.summary_locked,
    });
    return { state, text: loaded.sections.summary, output: loaded.sections.output };
  }

  /**
   * Make sure every node on the path that falls outside the recent window has a usable summary,
   * generating missing or stale ones. Throws SummaryCancelled if the author cancels.
   */
  async ensureForPath(parent: NodeMeta | null, recentTurns: number, generation: SummaryModel): Promise<void> {
    if (!parent || recentTurns <= 0) return;
    const path = this.plugin.store.index.pathTo(parent);
    const older = path.slice(0, Math.max(0, path.length - recentTurns));

    const todo: NodeMeta[] = [];
    for (const meta of older) {
      const info = await this.inspect(meta);
      if (!info.output.trim()) continue; // nothing to summarize (failed or empty node)
      if (info.state === "edited") await this.setLocked(meta);
      else if (info.state === "missing" || info.state === "stale") todo.push(meta);
    }
    if (!todo.length) return;

    const target = this.modelFor(generation);
    await this.plugin.ensureModel(target.provider, target.model);

    const controller = new AbortController();
    let modal: ProgressModal | null = null;
    let notice: Notice | null = null;
    if (todo.length >= 3) {
      modal = new ProgressModal(this.app, {
        title: `Summarizing ${todo.length} earlier turns`,
        total: todo.length,
        onCancel: () => controller.abort(),
      });
      modal.open();
    } else {
      notice = new Notice(`Summarizing ${todo.length} earlier turn${todo.length > 1 ? "s" : ""}…`, 0);
    }

    try {
      for (let i = 0; i < todo.length; i++) {
        if (controller.signal.aborted) throw new SummaryCancelled();
        modal?.update(i, `Turn ${i + 1} of ${todo.length}: ${todo[i].label || todo[i].title}`);
        try {
          await this.summarize(todo[i], target, controller.signal);
        } catch (e) {
          if (controller.signal.aborted || (e instanceof ProviderError && e.kind === "abort")) throw new SummaryCancelled();
          throw new Error(
            `Could not summarize "${todo[i].label || todo[i].title}": ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      modal?.update(todo.length, "Done");
    } finally {
      notice?.hide();
      modal?.finish();
    }
  }

  /** Force a fresh summary for one node, replacing even a hand-written one. */
  async regenerate(meta: NodeMeta, generation: SummaryModel): Promise<void> {
    const target = this.modelFor(generation);
    await this.plugin.ensureModel(target.provider, target.model);
    const notice = new Notice("Summarizing…", 0);
    try {
      await this.summarize(meta, target, undefined);
      new Notice("Summary updated.");
    } finally {
      notice.hide();
    }
  }

  private async summarize(meta: NodeMeta, target: SummaryModel, signal: AbortSignal | undefined): Promise<void> {
    const file = this.plugin.store.fileFor(meta);
    if (!file) throw new Error("the note is missing");
    const loaded = await this.plugin.store.load(file);
    const output = loaded.sections.output.trim();
    if (!output) throw new Error("the node has no output yet");

    const provider = this.plugin.providerConfig(target.provider);
    if (target.provider === "openrouter" && !provider.apiKey) throw new Error("OpenRouter API key is not set.");
    const result = await chatCompletion(
      provider,
      {
        model: target.model,
        messages: summaryMessages(output),
        temperature: SUMMARY_TEMPERATURE,
        maxTokens: SUMMARY_MAX_TOKENS,
        signal,
      },
      {},
      this.plugin.clientDeps,
    );
    const summary = cleanSummary(result.text);
    if (!summary) throw new Error("the model returned an empty summary");
    await this.write(file, output, summary);
  }

  private async write(file: TFile, output: string, summary: string): Promise<void> {
    const outputHash = hashOf(output);
    let written: string | null = null;
    await this.app.vault.process(file, (text) => {
      const current = parseNodeText(text).sections.output;
      if (hashOf(current) !== outputHash) return text; // output changed while we were summarizing
      const updated = replaceSection(text, "summary", summary);
      written = parseNodeText(updated).sections.summary;
      return updated;
    });
    if (written === null) return; // leave it empty; it will be redone next time
    const check = hashOf(written);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.summary_hash = outputHash;
      fm.summary_check = check;
      delete fm.summary_locked;
    });
  }

  private async setLocked(meta: NodeMeta): Promise<void> {
    const file = this.plugin.store.fileFor(meta);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.summary_locked = true;
    });
  }
}
