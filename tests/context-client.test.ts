import { describe, expect, it } from "vitest";
import { buildContext, PathTurn } from "../src/core/context";
import { WikiLink } from "../src/core/links";
import {
  chatCompletion,
  ClientDeps,
  parseCompletion,
  ProviderConfig,
  ProviderError,
  SseParser,
} from "../src/api/client";

const turn = (id: string, prompt: string, output: string, summary: string | null = null, keep = ""): PathTurn => ({
  id,
  prompt,
  output,
  summary,
  keep,
});

const notes: Record<string, string> = {
  atka: "Atka is a healer.\n## Looks\ngrey hair",
  koss: "Koss is a soldier.",
};
const resolveNote = async (l: WikiLink) => {
  const text = notes[l.target.toLowerCase()];
  if (!text) return null;
  return { title: l.target, text: l.heading ? text.split("## Looks\n")[1] ?? "" : text };
};

const story = { systemPrompt: "SYS", lore: "World of ice. See [[Koss]].", loreLinks: [], pinned: "- never snows" };

describe("context assembly", () => {
  it("orders parts and sends full history when recentTurns is infinite", async () => {
    const ctx = await buildContext({
      story,
      turns: [turn("1", "p1", "o1"), turn("2", "p2", "o2")],
      newPrompt: "p3",
      recentTurns: Infinity,
      resolveNote,
    });
    expect(ctx.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    const sys = ctx.messages[0].content;
    expect(sys.indexOf("SYS")).toBeLessThan(sys.indexOf("<lore>"));
    expect(sys.indexOf("<lore>")).toBeLessThan(sys.indexOf("<pinned_details>"));
    expect(sys).toContain("Koss is a soldier.");
    expect(sys).toContain("World of ice. See Koss.");
    expect(ctx.messages.at(-1)!.content).toBe("p3");
  });

  it("uses summaries for older turns and only recent prompts' links", async () => {
    const ctx = await buildContext({
      story: { ...story, lore: "", pinned: "" },
      turns: [
        turn("1", "Atka arrives [[Atka]]", "o1", "S1"),
        turn("2", "p2", "o2", "S2"),
        turn("3", "p3 [[Koss]]", "o3"),
      ],
      newPrompt: "p4",
      recentTurns: 2,
      resolveNote,
    });
    const sys = ctx.messages[0].content;
    expect(sys).toContain("1. S1");
    expect(sys).not.toContain("S2"); // turn 2 is recent, sent verbatim
    expect(ctx.messages.map((m) => m.content)).toEqual([sys, "p2", "o2", "p3 Koss", "o3", "p4"]);
    expect(sys).toContain("Koss is a soldier."); // linked from a recent prompt
    expect(sys).not.toContain("Atka is a healer"); // link from an old prompt fell out of the window
  });

  it("keeps 'keep in mind' links for the whole branch and dedupes notes", async () => {
    const ctx = await buildContext({
      story: { ...story, lore: "", pinned: "" },
      turns: [turn("1", "p1", "o1", "S1", "- remember [[Atka#Looks]]"), turn("2", "p2 [[Koss]]", "o2"), turn("3", "p3 [[Koss]]", "o3")],
      newPrompt: "p4 [[Koss]]",
      recentTurns: 1,
      resolveNote,
    });
    const sys = ctx.messages[0].content;
    expect(sys).toContain("grey hair");
    expect(sys.match(/Koss is a soldier\./g)?.length).toBe(1);
    expect(sys).toContain("remember Atka"); // wikilink removed from the keep text
    expect(ctx.linkedNotes.map((n) => n.title)).toEqual(["Atka > Looks", "Koss"]);
  });

  it("warns on missing notes and skips turns without output", async () => {
    const ctx = await buildContext({
      story: { ...story, lore: "", pinned: "" },
      turns: [turn("1", "p1", "o1"), turn("2", "p2", "")],
      newPrompt: "p3 [[Nobody]]",
      recentTurns: Infinity,
      resolveNote,
    });
    expect(ctx.warnings.length).toBe(2);
    expect(ctx.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("falls back to full output when a summary is missing", async () => {
    const ctx = await buildContext({
      story: { ...story, lore: "", pinned: "" },
      turns: [turn("1", "p1", "FULL1"), turn("2", "p2", "o2")],
      newPrompt: "p3",
      recentTurns: 1,
      resolveNote,
    });
    expect(ctx.messages[0].content).toContain("FULL1");
    expect(ctx.warnings.some((w) => w.includes("No summary"))).toBe(true);
  });
});

describe("provider client", () => {
  it("parses SSE split across chunks", () => {
    const p = new SseParser();
    expect(p.push('data: {"a":1}\n\nda')).toEqual(['{"a":1}']);
    expect(p.push('ta: [DONE]\n\n')).toEqual(["[DONE]"]);
    expect(p.push(": comment\n\n")).toEqual([]);
    expect(p.push('data: {"b":2}')).toEqual([]);
    expect(p.flush()).toEqual(['{"b":2}']);
  });

  it("reads text, reasoning and usage in both provider dialects", () => {
    expect(parseCompletion({ choices: [{ delta: { content: "Hi", reasoning: "think" } }] })).toMatchObject({ text: "Hi", reasoning: "think" });
    expect(parseCompletion({ choices: [{ delta: { reasoning_content: "lm" } }] }).reasoning).toBe("lm");
    expect(parseCompletion({ choices: [{ delta: { reasoning_details: [{ text: "a" }, { summary: "b" }] } }] }).reasoning).toBe("ab");
    const u = parseCompletion({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.01 } });
    expect(u.usage).toEqual({ inputTokens: 3, outputTokens: 4, cost: 0.01 });
    expect(() => parseCompletion({ error: { message: "bad model", code: 404 } })).toThrow("bad model");
  });

  const provider: ProviderConfig = { kind: "openrouter", baseUrl: "https://x/api/v1/", apiKey: "k" };
  const sseResponse = (chunks: string[], status = 200): Response => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    return new Response(stream, { status });
  };

  it("streams text and reports usage", async () => {
    const deps: ClientDeps = {
      fetch: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
          "data: [DONE]\n\n",
        ]),
      request: async () => {
        throw new Error("unused");
      },
    };
    const seen: string[] = [];
    const res = await chatCompletion(provider, { model: "m", messages: [{ role: "user", content: "hi" }] }, { onText: (d) => seen.push(d) }, deps);
    expect(res.text).toBe("Hello");
    expect(seen).toEqual(["Hel", "lo"]);
    expect(res.usage?.outputTokens).toBe(2);
    expect(res.streamed).toBe(true);
  });

  it("names the provider message on HTTP errors", async () => {
    const deps: ClientDeps = {
      fetch: async () => new Response(JSON.stringify({ error: { message: "No endpoints found for foo/bar", code: 404 } }), { status: 404 }),
      request: async () => {
        throw new Error("unused");
      },
    };
    await expect(chatCompletion(provider, { model: "foo/bar", messages: [] }, {}, deps)).rejects.toThrow(/HTTP 404: No endpoints found for foo\/bar/);
  });

  it("falls back to non-streaming when fetch fails (e.g. CORS)", async () => {
    const deps: ClientDeps = {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      request: async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: "Fallback" }, finish_reason: "stop" }] }) }),
    };
    const res = await chatCompletion({ ...provider, kind: "lmstudio" }, { model: "m", messages: [] }, {}, deps);
    expect(res.text).toBe("Fallback");
    expect(res.streamed).toBe(false);
  });

  it("reports an unreachable provider clearly", async () => {
    const deps: ClientDeps = {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      request: async () => {
        throw new Error("net::ERR_CONNECTION_REFUSED");
      },
    };
    await expect(chatCompletion({ ...provider, kind: "lmstudio", baseUrl: "http://localhost:1234/v1" }, { model: "m", messages: [] }, {}, deps)).rejects.toThrow(
      /LM Studio is unreachable at http:\/\/localhost:1234\/v1.*CONNECTION_REFUSED/,
    );
  });

  it("maps an aborted request to an abort error and keeps partial text via callbacks", async () => {
    const ctrl = new AbortController();
    const deps: ClientDeps = {
      fetch: async () => {
        ctrl.abort();
        throw new DOMException("aborted", "AbortError");
      },
      request: async () => {
        throw new Error("unused");
      },
    };
    const err = await chatCompletion(provider, { model: "m", messages: [], signal: ctrl.signal }, {}, deps).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("abort");
  });

  it("explains empty replies", async () => {
    const deps: ClientDeps = {
      fetch: async () => sseResponse(['data: {"choices":[{"delta":{"reasoning":"hmm"},"finish_reason":"length"}]}\n\n', "data: [DONE]\n\n"]),
      request: async () => {
        throw new Error("unused");
      },
    };
    await expect(chatCompletion(provider, { model: "m", messages: [] }, {}, deps)).rejects.toThrow(/no text.*length.*only reasoning/s);
  });
});
