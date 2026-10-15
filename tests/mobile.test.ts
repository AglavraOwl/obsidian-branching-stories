import { describe, expect, it } from "vitest";
import { chatCompletion, ClientDeps, ProviderConfig, ProviderError } from "../src/api/client";
import { displayStatus, STALE_AFTER_MS } from "../src/core/status";

const provider: ProviderConfig = { kind: "lmstudio", baseUrl: "http://192.168.1.20:1234/v1", apiKey: "" };
const okBody = JSON.stringify({ choices: [{ message: { content: "Done." }, finish_reason: "stop" }] });

describe("stream: false", () => {
  it("makes one plain request and never touches fetch", async () => {
    let fetched = false;
    const bodies: Record<string, unknown>[] = [];
    const deps: ClientDeps = {
      fetch: async () => {
        fetched = true;
        throw new Error("fetch must not be used");
      },
      request: async (o) => {
        bodies.push(JSON.parse(o.body ?? "{}"));
        return { status: 200, text: okBody };
      },
    };
    const res = await chatCompletion(provider, { model: "m", messages: [], stream: false }, {}, deps);
    expect(res.text).toBe("Done.");
    expect(res.streamed).toBe(false);
    expect(fetched).toBe(false);
    expect(bodies[0].stream).toBe(false);
    expect(bodies[0]).not.toHaveProperty("stream_options");
  });

  it("Stop answers immediately even though the request cannot be cancelled", async () => {
    const ctrl = new AbortController();
    const deps: ClientDeps = {
      fetch: async () => {
        throw new Error("unused");
      },
      request: () => new Promise(() => {}), // never answers
    };
    const pending = chatCompletion(provider, { model: "m", messages: [], stream: false, signal: ctrl.signal }, {}, deps).catch((e) => e);
    setTimeout(() => ctrl.abort(), 10);
    const err = await pending;
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("abort");
  });

  it("an aborted signal never sends the request", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let sent = false;
    const deps: ClientDeps = {
      fetch: async () => {
        throw new Error("unused");
      },
      request: async () => {
        sent = true;
        return { status: 200, text: okBody };
      },
    };
    await expect(chatCompletion(provider, { model: "m", messages: [], stream: false, signal: ctrl.signal }, {}, deps)).rejects.toThrow("Generation stopped.");
    expect(sent).toBe(false);
  });

  it("reports an unreachable address with the LM Studio hint", async () => {
    const deps: ClientDeps = {
      fetch: async () => {
        throw new Error("unused");
      },
      request: async () => {
        throw new Error("net::ERR_ADDRESS_UNREACHABLE");
      },
    };
    await expect(chatCompletion(provider, { model: "m", messages: [], stream: false }, {}, deps)).rejects.toThrow(
      /unreachable at http:\/\/192\.168\.1\.20:1234\/v1.*exposed on the local network/s,
    );
  });
});

describe("display status", () => {
  const created = "2026-10-09T09:00:00";
  const base = Date.parse(created);
  it("only a long-stale generating node that is not running here becomes interrupted", () => {
    expect(displayStatus("generating", created, base + 60_000, false)).toBe("generating");
    expect(displayStatus("generating", created, base + STALE_AFTER_MS + 1000, false)).toBe("interrupted");
    expect(displayStatus("generating", created, base + STALE_AFTER_MS + 1000, true)).toBe("generating");
    expect(displayStatus("done", created, base + STALE_AFTER_MS * 10, false)).toBe("done");
    expect(displayStatus("failed", created, base + STALE_AFTER_MS * 10, false)).toBe("failed");
    expect(displayStatus("generating", "not a date", base, false)).toBe("generating");
  });
});
