import { Notice, TFile, normalizePath, parseYaml } from "obsidian";
import { chatCompletion, ProviderError, ProviderKind, Usage } from "../api/client";
import { BuiltContext, buildContext, PathTurn } from "../core/context";
import { makeFileName, makeTimestamp, makeTitle, makeUniqueId, makeWikilink } from "../core/ids";
import { extractHeadingSection, stripFrontmatter } from "../core/links";
import { NodeFrontmatter, NodeSections, NodeStatus, serializeNode, splitFrontmatter } from "../core/nodeDoc";
import {
  linksFromLoreProperty,
  NODES_FOLDER,
  overridesFromFrontmatter,
  parseStoryBody,
  StoryDoc,
} from "../core/storyDoc";
import { evaluateSummary, isUsable } from "../core/summary";
import { NodeMeta } from "../core/tree";
import type BranchingStoriesPlugin from "./main";
import { ConfirmModal } from "./modals";
import { SummaryCancelled } from "./summaries";

export interface GenerateParams {
  storyFolder: string;
  /** Node to continue from; null for the first node of the story. */
  parent: NodeMeta | null;
  prompt: string;
  /** Id of the original node when this is a regeneration. */
  regenOf: string | null;
  /** "Keep in mind" text carried over from the node being replaced. */
  keep?: string;
}

export interface EffectiveConfig {
  provider: ProviderKind;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number | null;
  reasoning: boolean;
  recentTurns: number;
}

export interface StoryData {
  rootFile: TFile;
  fm: Record<string, unknown>;
  story: StoryDoc;
  config: EffectiveConfig;
}

export interface PreparedContext {
  config: EffectiveConfig;
  context: BuiltContext;
}

const STALE_AFTER_MS = 5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 1000;

export class GenerationController {
  private active = new Map<string, AbortController>();

  constructor(private plugin: BranchingStoriesPlugin) {}

  private get app() {
    return this.plugin.app;
  }

  private key(meta: NodeMeta): string {
    return `${meta.story}\u0000${meta.id}`;
  }

  isGenerating(meta: NodeMeta): boolean {
    return this.active.has(this.key(meta));
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** Stop generation of the given node, or of the only running one. */
  stop(meta?: NodeMeta): boolean {
    if (meta) {
      const c = this.active.get(this.key(meta));
      c?.abort();
      return !!c;
    }
    if (this.active.size === 1) {
      [...this.active.values()][0].abort();
      return true;
    }
    return false;
  }

  // ---- context ------------------------------------------------------------------

  /** Read the story's root note: its text sections, lore links and effective settings. */
  async loadStory(storyFolder: string): Promise<StoryData> {
    const rootFile = this.plugin.store.storyRootFile(storyFolder);
    if (!rootFile) throw new Error(`No ${storyFolder}/_story.md found for this story.`);
    const rootText = await this.app.vault.read(rootFile);
    const { frontmatter: fmText, body } = splitFrontmatter(rootText);
    let fm: Record<string, unknown> = {};
    if (fmText) {
      try {
        fm = (parseYaml(fmText) as Record<string, unknown>) ?? {};
      } catch (e) {
        throw new Error(`The properties of ${rootFile.path} are not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return {
      rootFile,
      fm,
      story: parseStoryBody(body),
      config: this.plugin.effectiveConfig(overridesFromFrontmatter(fm)),
    };
  }

  /**
   * Assemble the context for a new node. In "send" mode missing or stale summaries of older turns
   * are generated first; in "preview" mode nothing is sent and pending summaries are marked.
   */
  async prepare(
    data: StoryData,
    parent: NodeMeta | null,
    prompt: string,
    mode: "send" | "preview",
  ): Promise<PreparedContext> {
    const { rootFile, fm, story, config } = data;
    const store = this.plugin.store;
    const recentTurns = config.recentTurns > 0 ? config.recentTurns : Infinity;

    if (mode === "send" && Number.isFinite(recentTurns)) {
      await this.plugin.summaries.ensureForPath(parent, recentTurns, config);
    }

    const turns: PathTurn[] = [];
    if (parent) {
      for (const meta of store.index.pathTo(parent)) {
        const loaded = await store.loadMeta(meta);
        if (!loaded) continue;
        const state = evaluateSummary({
          output: loaded.sections.output,
          summary: loaded.sections.summary,
          hash: loaded.frontmatter.summary_hash,
          check: loaded.frontmatter.summary_check,
          locked: loaded.frontmatter.summary_locked,
        });
        let summary: string | null = isUsable(state) ? loaded.sections.summary : null;
        if (summary === null && mode === "preview" && loaded.sections.output.trim()) {
          summary = "(summary will be generated when you send)";
        }
        turns.push({
          id: meta.id,
          prompt: loaded.sections.prompt,
          output: loaded.sections.output,
          summary,
          keep: loaded.sections.keep,
        });
      }
    }

    const context = await buildContext({
      story: {
        systemPrompt: story.systemPrompt,
        lore: story.lore,
        loreLinks: linksFromLoreProperty(fm.lore),
        pinned: story.pinned,
      },
      turns,
      newPrompt: prompt,
      recentTurns,
      resolveNote: async (link) => {
        const dest = this.app.metadataCache.getFirstLinkpathDest(link.target, rootFile.path);
        if (!dest || dest.extension !== "md") return null;
        let text = stripFrontmatter(await this.app.vault.cachedRead(dest));
        if (link.heading) {
          const section = extractHeadingSection(text, link.heading);
          if (!section) return null;
          text = section;
        }
        return { title: dest.basename, text };
      },
    });
    return { config, context };
  }

  // ---- generation ----------------------------------------------------------------

  async run(params: GenerateParams): Promise<TFile | null> {
    const { plugin } = this;
    const store = plugin.store;
    let prepared: PreparedContext;
    try {
      const data = await this.loadStory(params.storyFolder);
      await plugin.ensureModel(data.config.provider, data.config.model);
      const key = plugin.providerConfig(data.config.provider);
      if (data.config.provider === "openrouter" && !key.apiKey) {
        throw new Error("OpenRouter API key is not set. Add it in the plugin settings.");
      }
      prepared = await this.prepare(data, params.parent, params.prompt, "send");
    } catch (e) {
      if (e instanceof SummaryCancelled) {
        new Notice("Cancelled. Nothing was generated.");
        return null;
      }
      this.report(e);
      return null;
    }
    const { config, context } = prepared;
    const provider = plugin.providerConfig(config.provider);

    if (context.totalTokens > plugin.settings.maxContextTokens) {
      const ok = await new ConfirmModal(this.app, {
        title: "Large context",
        body:
          `Estimated input: ~${context.totalTokens} tokens (warning limit ${plugin.settings.maxContextTokens}).\n\n` +
          context.parts.map((p) => `${p.label}: ~${p.tokens}`).join("\n"),
        confirmLabel: "Send anyway",
      }).open();
      if (!ok) return null;
    }
    if (context.warnings.length) new Notice(context.warnings.join("\n"), 8000);

    // ---- create the node -----------------------------------------------------
    const now = new Date();
    const id = makeUniqueId(now, (candidate) => store.index.hasId(params.storyFolder, candidate));
    const title = makeTitle(params.prompt);
    const nodesDir = normalizePath(`${params.storyFolder}/${NODES_FOLDER}`);
    if (!this.app.vault.getAbstractFileByPath(nodesDir)) await this.app.vault.createFolder(nodesDir);
    const path = normalizePath(`${nodesDir}/${makeFileName(id, title)}`);

    const parentFile = params.parent ? store.fileFor(params.parent) : null;
    const regenMeta = params.regenOf ? store.index.get(params.storyFolder, params.regenOf) : undefined;
    const regenFile = regenMeta ? store.fileFor(regenMeta) : null;

    const fm: NodeFrontmatter = {
      id,
      parent: parentFile ? makeWikilink(parentFile.basename) : "",
      regen_of: regenFile ? makeWikilink(regenFile.basename) : undefined,
      created: makeTimestamp(now),
      status: "generating",
      provider: config.provider,
      model: config.model,
      settings: {
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP ?? undefined,
      },
    };
    const sections: NodeSections = {
      prompt: params.prompt,
      output: "",
      reasoning: "",
      summary: "",
      keep: params.keep ?? "",
    };

    const file = await this.app.vault.create(path, serializeNode(fm, sections));
    const meta: NodeMeta = {
      id,
      path,
      story: params.storyFolder,
      parentId: params.parent?.id ?? null,
      regenOf: regenMeta?.id ?? null,
      created: fm.created,
      status: "generating",
      starred: false,
      label: "",
      title,
      model: config.model,
    };
    store.addMeta(meta);
    await this.app.workspace.getLeaf(false).openFile(file);

    // ---- stream ----------------------------------------------------------------
    const controller = new AbortController();
    this.active.set(this.key(meta), controller);
    plugin.refreshStatusBar();

    let lastFlush = 0;
    let flushTimer: number | null = null;
    let writing: Promise<void> = Promise.resolve();
    const write = (): void => {
      lastFlush = Date.now();
      const text = serializeNode(fm, sections);
      writing = writing.then(() => this.app.vault.modify(file, text)).catch((e) => console.error("[Branching Stories] write failed", e));
    };
    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      const wait = Math.max(0, FLUSH_INTERVAL_MS - (Date.now() - lastFlush));
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        write();
      }, wait);
    };

    let finalStatus: NodeStatus = "done";
    let usage: Usage | undefined;
    try {
      const result = await chatCompletion(
        provider,
        {
          model: config.model,
          messages: context.messages,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          topP: config.topP ?? undefined,
          reasoning: config.reasoning,
          signal: controller.signal,
        },
        {
          onText: (d) => {
            sections.output += d;
            scheduleFlush();
          },
          onReasoning: (d) => {
            if (config.reasoning) sections.reasoning += d;
            scheduleFlush();
          },
        },
        plugin.clientDeps,
      );
      usage = result.usage;
      if (result.finishReason === "length") {
        new Notice("The reply was cut off by the Max tokens limit.", 8000);
      }
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "abort") {
        finalStatus = "stopped";
      } else {
        finalStatus = "failed";
        fm.error = e instanceof Error ? e.message : String(e);
        this.report(e);
      }
    } finally {
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      this.active.delete(this.key(meta));
    }

    fm.status = finalStatus;
    if (usage) {
      fm.usage = { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cost: usage.cost };
    }
    write();
    await writing;
    store.addMeta({ ...meta, status: finalStatus });
    plugin.refreshStatusBar();
    if (finalStatus === "done") {
      const t = usage?.outputTokens ? ` · ${usage.outputTokens} tokens out` : "";
      new Notice(`Done${t}.`);
    }
    return file;
  }

  report(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Branching Stories]", e);
    new Notice(message, 15000);
  }

  // ---- housekeeping ---------------------------------------------------------------

  /** Mark nodes stuck in `generating` (interrupted requests) as failed. */
  async failStale(): Promise<number> {
    const store = this.plugin.store;
    const now = Date.now();
    let count = 0;
    const stale: NodeMeta[] = [];
    // Walk every story's nodes through the index by path scan.
    for (const file of this.app.vault.getMarkdownFiles()) {
      const meta = store.index.getByPath(file.path);
      if (!meta || meta.status !== "generating" || this.isGenerating(meta)) continue;
      const created = Date.parse(meta.created);
      if (Number.isFinite(created) && now - created < STALE_AFTER_MS) continue;
      stale.push(meta);
    }
    for (const meta of stale) {
      const file = store.fileFor(meta);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.status = "failed";
        fm.error = "Interrupted: generation did not finish.";
      });
      store.addMeta({ ...meta, status: "failed" });
      count++;
    }
    return count;
  }
}

