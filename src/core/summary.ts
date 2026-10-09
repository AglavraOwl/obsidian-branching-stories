import { ChatMessage } from "./context";
import { hashOf } from "./hash";

/**
 * - missing: no summary text
 * - valid:   written by the plugin from the current Output
 * - stale:   written by the plugin, but the Output changed since
 * - locked:  the author marked it (or it was marked) as hand-written
 * - edited:  text differs from what the plugin wrote (or was never written by it): treat as hand-written and lock it
 */
export type SummaryState = "missing" | "valid" | "stale" | "locked" | "edited";

export interface SummaryFields {
  output: string;
  summary: string;
  /** `summary_hash`: hash of the Output the summary was made from. */
  hash?: unknown;
  /** `summary_check`: hash of the summary text as the plugin wrote it. */
  check?: unknown;
  locked?: unknown;
}

export function evaluateSummary(f: SummaryFields): SummaryState {
  const summary = f.summary.trim();
  if (!summary) return "missing";
  if (f.locked === true) return "locked";
  if (typeof f.check !== "string" || f.check !== hashOf(summary)) return "edited";
  return f.hash === hashOf(f.output) ? "valid" : "stale";
}

/** Whether the text of this summary can be sent as context. */
export function isUsable(state: SummaryState): boolean {
  return state === "valid" || state === "locked" || state === "edited";
}

export function summaryMessages(passage: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: "You write concise continuity summaries of story passages. Reply with the summary only.",
    },
    {
      role: "user",
      content:
        "Summarize the following passage in about 60 to 120 words. Keep names, events, changes in state " +
        "(injuries, places, relationships, what each character knows) and unresolved threads. " +
        "Write plain prose in the past tense, with no preamble, headings or commentary.\n\n" +
        `<passage>\n${passage.trim()}\n</passage>`,
    },
  ];
}

export function cleanSummary(text: string): string {
  return text
    .trim()
    .replace(/^(?:here(?:'s| is) (?:a |the )?summary:?|summary:?)\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Output sections of the path joined into one reading text. */
export function compileOutputs(outputs: string[]): string {
  return outputs
    .map((o) => o.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}
