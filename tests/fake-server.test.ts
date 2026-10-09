import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { chatCompletion, ClientDeps, fetchModels, ProviderConfig } from "../src/api/client";
// @ts-expect-error plain JS helper
import { startFakeServer } from "../scripts/fake-llm.mjs";

let server: Server;
const provider: ProviderConfig = { kind: "lmstudio", baseUrl: "http://127.0.0.1:18234/v1", apiKey: "" };
const deps: ClientDeps = {
  fetch: (i, init) => fetch(i, init),
  request: async (o) => {
    const r = await fetch(o.url, { method: o.method, headers: o.headers, body: o.body });
    return { status: r.status, text: await r.text() };
  },
};

beforeAll(async () => {
  server = await startFakeServer(18234, { delayMs: 1 });
});
afterAll(() => {
  server.close();
});

describe("against a real HTTP server", () => {
  it("lists models", async () => {
    const models = await fetchModels(provider, deps);
    expect(models.map((m) => m.id)).toEqual(["fake-writer", "fake-writer-2"]);
  });

  it("streams over real chunked HTTP", async () => {
    const deltas: string[] = [];
    const res = await chatCompletion(
      provider,
      { model: "fake-writer", messages: [{ role: "system", content: "S" }, { role: "user", content: "Go north" }] },
      { onText: (d) => deltas.push(d) },
      deps,
    );
    expect(deltas.length).toBeGreaterThan(5);
    expect(res.text).toContain('Last prompt: "Go north"');
    expect(res.usage?.outputTokens).toBeGreaterThan(0);
  });

  it("surfaces the server's error for an unknown model", async () => {
    await expect(chatCompletion(provider, { model: "nope", messages: [] }, {}, deps)).rejects.toThrow(/HTTP 404: Model "nope" not found/);
  });

  it("stops mid-stream and keeps what arrived", async () => {
    const ctrl = new AbortController();
    let text = "";
    const err = await chatCompletion(
      provider,
      { model: "fake-writer", messages: [{ role: "user", content: "x" }], signal: ctrl.signal },
      {
        onText: (d) => {
          text += d;
          if (text.length > 30) ctrl.abort();
        },
      },
      deps,
    ).catch((e) => e);
    expect((err as Error).message).toBe("Generation stopped.");
    expect(text.length).toBeGreaterThan(30);
  });
});
