/** A model and thinking choice made for a single generation. Missing parts keep the configured value. */
export interface GenerationOverride<P extends string = string> {
  provider?: P;
  model?: string;
  reasoning?: boolean;
}

/** The configured values with the per-generation choice on top. An empty model slug is ignored. */
export function applyOverride<C extends { provider: string; model: string; reasoning: boolean }>(
  config: C,
  override: GenerationOverride<C["provider"]> | undefined,
): C {
  if (!override) return config;
  const model = override.model?.trim();
  return {
    ...config,
    provider: model ? (override.provider ?? config.provider) : config.provider,
    model: model || config.model,
    reasoning: override.reasoning ?? config.reasoning,
  };
}

/**
 * Models offered by the chip in the prompt window: the starred ones in the order they were starred,
 * with the model currently in effect first when it is not starred (so it can be seen and kept).
 */
export function chipModels(favorites: string[], current: string): string[] {
  const list = [...new Set(favorites)];
  return current && !list.includes(current) ? [current, ...list] : list;
}

/** Adds the slug to the starred models, or removes it when it is there already. */
export function toggleFavorite(favorites: string[], slug: string): string[] {
  return favorites.includes(slug) ? favorites.filter((f) => f !== slug) : [...favorites, slug];
}
