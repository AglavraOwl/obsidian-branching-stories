/** Rough token estimate: ~4 characters per token (fine for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
