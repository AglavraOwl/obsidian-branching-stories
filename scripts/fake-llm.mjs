// A tiny OpenAI-compatible server for trying the plugin without spending money.
// Run:  node scripts/fake-llm.mjs [port]      (default port 1234)
// Then in the plugin settings: provider LM Studio, base URL http://localhost:1234/v1, model "fake-writer".
// It echoes what it received, so you can see exactly which context the plugin sent.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const MODELS = ["fake-writer", "fake-writer-2"];

export function startFakeServer(port = 1234, { delayMs = 40 } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: MODELS.map((id) => ({ id })) }));
    }

    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (!MODELS.includes(body.model)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: `Model "${body.model}" not found`, code: 404 } }));
      }
      const msgs = body.messages ?? [];
      const last = msgs.filter((m) => m.role === "user").at(-1)?.content ?? "";
      const sys = msgs.find((m) => m.role === "system")?.content ?? "";
      const text =
        `[fake reply] ${msgs.length} messages received (${msgs.map((m) => m.role[0]).join("")}), ` +
        `system prompt ${sys.length} chars. Last prompt: "${last.slice(0, 200)}".\n\n` +
        "The wind dropped at dusk and the cottage settled around them. Nothing moved but the fire, " +
        "and for a while that was enough.\n\nIn the morning the snow had stopped.";
      const words = text.split(/(?<=\s)/);

      if (!body.stream) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: words.length } }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      let closed = false;
      req.on("close", () => (closed = true));
      for (const w of words) {
        if (closed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: words.length } })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 1234);
  await startFakeServer(port);
  console.log(`Fake LLM listening on http://localhost:${port}/v1  (models: ${MODELS.join(", ")})`);
}
