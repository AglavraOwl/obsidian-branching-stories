import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { ModelInfo, PROVIDER_LABEL, ProviderKind } from "../api/client";
import type BranchingStoriesPlugin from "./main";
import { pickModel } from "./modals";

export interface GenerationSettings {
  provider: ProviderKind;
  model: string;
  temperature: number;
  maxTokens: number;
  /** null = do not send top_p */
  topP: number | null;
  /** Store reasoning text when the provider returns it. */
  reasoning: boolean;
}

export interface BSSettings {
  storiesRoot: string;
  generation: GenerationSettings;
  /** Most recent turns sent in full; 0 = send everything (no summaries). */
  recentTurns: number;
  maxContextTokens: number;
  providers: {
    lmstudio: { baseUrl: string };
    openrouter: { baseUrl: string; keySecretName: string; keyPlain: string };
  };
  favorites: Record<ProviderKind, string[]>;
  modelCache: Record<ProviderKind, { fetchedAt: number; models: ModelInfo[] }>;
}

export const DEFAULT_SETTINGS: BSSettings = {
  storiesRoot: "Stories",
  generation: {
    provider: "openrouter",
    model: "",
    temperature: 0.9,
    maxTokens: 4000,
    topP: null,
    reasoning: false,
  },
  recentTurns: 0,
  maxContextTokens: 32000,
  providers: {
    lmstudio: { baseUrl: "http://localhost:1234/v1" },
    openrouter: { baseUrl: "https://openrouter.ai/api/v1", keySecretName: "openrouter-api-key", keyPlain: "" },
  },
  favorites: { lmstudio: [], openrouter: [] },
  modelCache: {
    lmstudio: { fetchedAt: 0, models: [] },
    openrouter: { fetchedAt: 0, models: [] },
  },
};

/** Merge saved data over the defaults (one level deep for the nested groups). */
export function mergeSettings(saved: Partial<BSSettings> | null | undefined): BSSettings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    generation: { ...DEFAULT_SETTINGS.generation, ...(s.generation ?? {}) },
    providers: {
      lmstudio: { ...DEFAULT_SETTINGS.providers.lmstudio, ...(s.providers?.lmstudio ?? {}) },
      openrouter: { ...DEFAULT_SETTINGS.providers.openrouter, ...(s.providers?.openrouter ?? {}) },
    },
    favorites: { ...DEFAULT_SETTINGS.favorites, ...(s.favorites ?? {}) },
    modelCache: { ...DEFAULT_SETTINGS.modelCache, ...(s.modelCache ?? {}) },
  };
}

export class BSSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BranchingStoriesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    // ---- generation -------------------------------------------------------
    new Setting(containerEl).setName("Generation").setHeading();

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Which provider writes new turns.")
      .addDropdown((d) =>
        d
          .addOption("openrouter", PROVIDER_LABEL.openrouter)
          .addOption("lmstudio", PROVIDER_LABEL.lmstudio)
          .setValue(s.generation.provider)
          .onChange(async (v) => {
            s.generation.provider = v as ProviderKind;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const kind = s.generation.provider;
    const cache = s.modelCache[kind];
    new Setting(containerEl)
      .setName("Model")
      .setDesc(
        cache.models.length
          ? `${cache.models.length} models fetched. Type a slug or use Choose.`
          : `No model list yet — press "Fetch models" for ${PROVIDER_LABEL[kind]} below.`,
      )
      .addText((t) =>
        t
          .setPlaceholder("model slug")
          .setValue(s.generation.model)
          .onChange(async (v) => {
            s.generation.model = v.trim();
            await this.plugin.saveSettings();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Choose…").onClick(async () => {
          const picked = await pickModel(this.app, this.plugin, kind);
          if (picked) {
            s.generation.model = picked;
            await this.plugin.saveSettings();
            this.display();
          }
        }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("star")
          .setTooltip("Add to favorites")
          .onClick(async () => {
            const slug = s.generation.model;
            if (slug && !s.favorites[kind].includes(slug)) {
              s.favorites[kind].push(slug);
              await this.plugin.saveSettings();
              this.display();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Temperature")
      .addSlider((sl) =>
        sl
          .setLimits(0, 2, 0.05)
          .setDynamicTooltip()
          .setValue(s.generation.temperature)
          .onChange(async (v) => {
            s.generation.temperature = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Upper limit for one generated turn (reasoning models also spend it on thinking).")
      .addText((t) =>
        t.setValue(String(s.generation.maxTokens)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) {
            s.generation.maxTokens = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Top P")
      .setDesc("Leave empty to not send it.")
      .addText((t) =>
        t
          .setPlaceholder("e.g. 0.95")
          .setValue(s.generation.topP === null ? "" : String(s.generation.topP))
          .onChange(async (v) => {
            const n = parseFloat(v);
            s.generation.topP = v.trim() === "" || !Number.isFinite(n) ? null : n;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Store reasoning")
      .setDesc("Ask for reasoning text where supported and keep it in a collapsed callout. It is never sent back as context.")
      .addToggle((t) =>
        t.setValue(s.generation.reasoning).onChange(async (v) => {
          s.generation.reasoning = v;
          await this.plugin.saveSettings();
        }),
      );

    // ---- favorites ----------------------------------------------------------
    for (const k of ["openrouter", "lmstudio"] as ProviderKind[]) {
      for (const slug of [...s.favorites[k]]) {
        new Setting(containerEl)
          .setName(`★ ${slug}`)
          .setDesc(`${PROVIDER_LABEL[k]} favorite`)
          .addButton((b) =>
            b.setButtonText("Use").onClick(async () => {
              s.generation.provider = k;
              s.generation.model = slug;
              await this.plugin.saveSettings();
              this.display();
            }),
          )
          .addExtraButton((b) =>
            b
              .setIcon("trash")
              .setTooltip("Remove from favorites")
              .onClick(async () => {
                s.favorites[k] = s.favorites[k].filter((x) => x !== slug);
                await this.plugin.saveSettings();
                this.display();
              }),
          );
      }
    }

    // ---- providers --------------------------------------------------------
    new Setting(containerEl).setName("OpenRouter").setHeading();
    this.baseUrlSetting("openrouter");
    this.apiKeySetting();
    this.fetchSetting("openrouter");

    new Setting(containerEl).setName("LM Studio").setHeading();
    this.baseUrlSetting("lmstudio");
    this.fetchSetting("lmstudio");

    // ---- stories ------------------------------------------------------------
    new Setting(containerEl).setName("Stories").setHeading();
    new Setting(containerEl)
      .setName("Stories folder")
      .setDesc("New stories are created inside this folder.")
      .addText((t) =>
        t.setValue(s.storiesRoot).onChange(async (v) => {
          s.storiesRoot = v.trim().replace(/^\/+|\/+$/g, "") || "Stories";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Context size warning")
      .setDesc("Ask before sending when the estimated input exceeds this many tokens.")
      .addText((t) =>
        t.setValue(String(s.maxContextTokens)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) {
            s.maxContextTokens = n;
            await this.plugin.saveSettings();
          }
        }),
      );
  }

  private baseUrlSetting(kind: ProviderKind): void {
    const cfg = this.plugin.settings.providers[kind];
    new Setting(this.containerEl)
      .setName("Base URL")
      .addText((t) =>
        t.setValue(cfg.baseUrl).onChange(async (v) => {
          cfg.baseUrl = v.trim();
          await this.plugin.saveSettings();
        }),
      );
  }

  private apiKeySetting(): void {
    const cfg = this.plugin.settings.providers.openrouter;
    const setting = new Setting(this.containerEl).setName("API key");
    if (this.plugin.hasSecretStorage()) {
      setting.setDesc("Stored in Obsidian's secret storage, not in your notes.");
      setting.addComponent((el) =>
        new SecretComponent(this.app, el).setValue(cfg.keySecretName).onChange(async (v) => {
          cfg.keySecretName = v;
          await this.plugin.saveSettings();
        }),
      );
    } else {
      setting.setDesc("This Obsidian version has no secret storage, so the key is kept in the plugin's data file (not in your notes).");
      setting.addText((t) => {
        t.inputEl.type = "password";
        t.setValue(cfg.keyPlain).onChange(async (v) => {
          cfg.keyPlain = v.trim();
          await this.plugin.saveSettings();
        });
      });
    }
  }

  private fetchSetting(kind: ProviderKind): void {
    const cache = this.plugin.settings.modelCache[kind];
    const when = cache.fetchedAt ? new Date(cache.fetchedAt).toLocaleString() : "never";
    new Setting(this.containerEl)
      .setName("Model list")
      .setDesc(`${cache.models.length} models, fetched ${when}.`)
      .addButton((b) =>
        b.setButtonText("Fetch models").onClick(async () => {
          b.setDisabled(true);
          try {
            const models = await this.plugin.refreshModels(kind);
            new Notice(`${PROVIDER_LABEL[kind]}: fetched ${models.length} models.`);
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e), 10000);
          }
          this.display();
        }),
      );
  }
}
