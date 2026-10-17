import { describe, expect, it } from "vitest";
import { parseCompletion } from "../src/api/client";

describe("usage", () => {
  it("reads reasoning tokens from completion_tokens_details", () => {
    const parsed = parseCompletion({
      choices: [{ message: { content: "Text." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 600 }, cost: 0.002 },
    });
    expect(parsed.usage).toEqual({ inputTokens: 100, outputTokens: 900, reasoningTokens: 600, cost: 0.002 });
  });

  it("leaves reasoning tokens out when the provider does not report them", () => {
    const parsed = parseCompletion({
      choices: [{ message: { content: "Text." } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    expect(parsed.usage?.reasoningTokens).toBeUndefined();
    expect(parsed.usage?.outputTokens).toBe(20);
  });
});
