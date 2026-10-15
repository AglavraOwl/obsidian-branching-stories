import { Notice, Platform, apiVersion } from "obsidian";
import { chatCompletion, ClientDeps, PROVIDER_LABEL } from "../api/client";
import type BranchingStoriesPlugin from "./main";
import { TextViewModal } from "./modals";

const TEST_PROMPT = "Count from 1 to 15, separated by spaces. Write only the numbers.";

function platformName(): string {
  const parts: string[] = [];
  if (Platform.isPhone) parts.push("phone");
  else if (Platform.isTablet) parts.push("tablet");
  else if (Platform.isDesktop) parts.push("desktop");
  if (Platform.isAndroidApp) parts.push("Android");
  else if (Platform.isIosApp) parts.push("iOS");
  else if (Platform.isWin) parts.push("Windows");
  else if (Platform.isMacOS) parts.push("macOS");
  else if (Platform.isLinux) parts.push("Linux");
  return parts.join(", ") || "unknown";
}

/**
 * Checks this device against the configured provider and reports what works: the model list, the
 * model slug, and whether replies can be streamed or have to arrive in one piece.
 */
export async function runConnectionTest(plugin: BranchingStoriesPlugin): Promise<void> {
  const cfg = plugin.effectiveConfig({});
  const provider = plugin.providerConfig(cfg.provider);
  const label = PROVIDER_LABEL[cfg.provider];
  const report: string[] = [
    `Device: ${platformName()} · Obsidian ${apiVersion} · plugin ${plugin.manifest.version}`,
    `Screen: ${window.innerWidth} × ${window.innerHeight}`,
    `Provider: ${label} · ${provider.baseUrl}`,
    `Model: ${cfg.model || "(none selected)"} · streaming setting: ${plugin.settings.streaming}`,
    "",
  ];
  const notice = new Notice("Testing the connection…", 0);
  let reply = "";

  try {
    // 1. model list (plain request, works everywhere)
    const t0 = Date.now();
    try {
      const models = await plugin.refreshModels(cfg.provider);
      report.push(`✔ Model list: ${models.length} models in ${Date.now() - t0} ms`);
    } catch (e) {
      report.push(`✘ Model list: ${e instanceof Error ? e.message : String(e)}`);
      if (cfg.provider === "lmstudio" && !plugin.hasLocalBaseUrl("lmstudio")) {
        report.push('  Hint: on a phone or tablet "localhost" is the device itself. Set the LM Studio address for this device in the plugin settings.');
      }
      return;
    }

    // 2. model slug
    try {
      await plugin.ensureModel(cfg.provider, cfg.model);
      report.push("✔ Model slug found in the list");
    } catch (e) {
      report.push(`✘ ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (cfg.provider === "openrouter" && !provider.apiKey) {
      report.push("✘ OpenRouter API key is not set on this device.");
      return;
    }

    // 3. a tiny generation, watching how the text arrives
    let fetchError = "";
    const deps: ClientDeps = {
      request: plugin.clientDeps.request,
      fetch: async (input, init) => {
        try {
          return await plugin.clientDeps.fetch(input, init);
        } catch (e) {
          fetchError = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    };
    const stamps: number[] = [];
    const start = Date.now();
    try {
      const result = await chatCompletion(
        provider,
        {
          model: cfg.model,
          messages: [{ role: "user", content: TEST_PROMPT }],
          temperature: 0,
          maxTokens: 120,
          stream: plugin.settings.streaming === "off" ? false : undefined,
        },
        { onText: () => stamps.push(Date.now() - start) },
        deps,
      );
      reply = result.text.trim();
      const total = Date.now() - start;
      if (result.streamed && stamps.length > 2) {
        report.push(`✔ Streaming works: ${stamps.length} pieces, first after ${stamps[0]} ms, done in ${total} ms`);
      } else if (result.streamed) {
        report.push(`✔ Replies arrive, but in ${stamps.length} piece${stamps.length === 1 ? "" : "s"} (done in ${total} ms).`);
        report.push("  This device (or the provider) delivers the stream in one go: it works, but text appears all at once.");
      } else if (plugin.settings.streaming === "off") {
        report.push(`✔ Non-streaming request works (${total} ms). Streaming is turned off in the settings.`);
      } else {
        report.push(`✔ Replies work, but without streaming (${total} ms).`);
        report.push(`  Streaming was blocked on this device${fetchError ? ` (${fetchError})` : ""}; the plugin falls back to one request per reply.`);
        report.push("  Text appears all at once when it is finished. Stop still works, but the request itself keeps running in the background.");
      }
    } catch (e) {
      report.push(`✘ Generation: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    notice.hide();
    new TextViewModal(plugin.app, {
      title: "Connection test",
      summary: report.join("\n"),
      body: reply ? `Test reply:\n${reply}` : "(no reply)",
    }).open();
  }
}
