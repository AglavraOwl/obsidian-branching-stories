import { ChatMessage } from "../core/context";

export type ProviderKind = "lmstudio" | "openrouter";

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
}

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  lmstudio: "LM Studio",
  openrouter: "OpenRouter",
};

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Ask the provider for reasoning text (OpenRouter) and keep it if returned. */
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface ChatCallbacks {
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export interface ChatResult {
  text: string;
  reasoning: string;
  usage?: Usage;
  finishReason?: string;
  streamed: boolean;
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

/** Minimal response shape shared by `fetch` and Obsidian's `requestUrl`. */
export interface SimpleResponse {
  status: number;
  text: string;
}

export interface ClientDeps {
  fetch: typeof fetch;
  /** Non-streaming, CORS-free request (Obsidian's `requestUrl`). */
  request: (opts: { url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<SimpleResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "http" | "network" | "abort" | "empty" | "stream",
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Incremental server-sent-events parser: feed text chunks, get `data:` payloads. */
export class SseParser {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const event = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const data = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) out.push(data);
    }
    return out;
  }

  /** Remaining payload when the stream ends without a trailing blank line. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const data = rest
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    return data ? [data] : [];
  }
}

interface RawChoice {
  delta?: Record<string, unknown>;
  message?: Record<string, unknown>;
  finish_reason?: string | null;
}

function reasoningFrom(obj: Record<string, unknown> | undefined): string {
  if (!obj) return "";
  // Providers differ: OpenRouter `reasoning`, LM Studio `reasoning_content`.
  for (const key of ["reasoning", "reasoning_content"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return v;
  }
  const details = obj.reasoning_details;
  if (Array.isArray(details)) {
    return details
      .map((d) => {
        const r = d as Record<string, unknown>;
        return typeof r.text === "string" ? r.text : typeof r.summary === "string" ? r.summary : "";
      })
      .join("");
  }
  return "";
}

function usageFrom(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const usage: Usage = {
    inputTokens: num(u.prompt_tokens),
    outputTokens: num(u.completion_tokens),
    cost: num(u.cost),
  };
  return usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cost === undefined
    ? undefined
    : usage;
}

export interface ParsedChunk {
  text: string;
  reasoning: string;
  usage?: Usage;
  finishReason?: string;
}

/** Extract text, reasoning and usage from one streamed chunk or a full non-streamed response. */
export function parseCompletion(json: unknown): ParsedChunk {
  const root = (json ?? {}) as Record<string, unknown>;
  if (root.error) throw providerErrorFromBody(root, undefined);
  const choice = (Array.isArray(root.choices) ? root.choices[0] : undefined) as RawChoice | undefined;
  const part = choice?.delta ?? choice?.message;
  const content = part && typeof part.content === "string" ? part.content : "";
  return {
    text: content,
    reasoning: reasoningFrom(part),
    usage: usageFrom(root.usage),
    finishReason: choice?.finish_reason ?? undefined,
  };
}

function providerErrorFromBody(body: Record<string, unknown>, status: number | undefined): ProviderError {
  const err = body.error as Record<string, unknown> | string | undefined;
  let message = "";
  if (typeof err === "string") message = err;
  else if (err && typeof err === "object") {
    message = typeof err.message === "string" ? err.message : JSON.stringify(err);
    const raw = (err.metadata as Record<string, unknown> | undefined)?.raw;
    if (typeof raw === "string" && raw && !message.includes(raw)) message += ` — ${raw}`;
  } else message = JSON.stringify(body);
  return new ProviderError(message, "http", status, JSON.stringify(body));
}

export function describeHttpError(label: string, status: number, bodyText: string): ProviderError {
  let detail = bodyText.trim();
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    detail = providerErrorFromBody(parsed, status).message;
  } catch {
    if (detail.length > 500) detail = detail.slice(0, 500) + "…";
  }
  return new ProviderError(`${label} returned HTTP ${status}: ${detail || "(empty response)"}`, "http", status, bodyText);
}

export function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function buildHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.kind === "openrouter") headers["X-Title"] = "Obsidian Branching Stories";
  return headers;
}

export function buildChatBody(provider: ProviderConfig, req: ChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, messages: req.messages, stream };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (stream) body.stream_options = { include_usage: true };
  if (req.reasoning && provider.kind === "openrouter") body.include_reasoning = true;
  return body;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function unreachable(provider: ProviderConfig, cause: unknown): ProviderError {
  const label = PROVIDER_LABEL[provider.kind];
  const hint =
    provider.kind === "lmstudio"
      ? " Is the LM Studio server running (Developer tab → Start Server)? On a phone or tablet it must be exposed on the local network and the Base URL must use the PC's address."
      : " Check your internet connection.";
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new ProviderError(`${label} is unreachable at ${provider.baseUrl} (${reason}).${hint}`, "network");
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === "AbortError" : e instanceof Error && e.name === "AbortError";
}

export async function chatCompletion(
  provider: ProviderConfig,
  req: ChatRequest,
  cb: ChatCallbacks,
  deps: ClientDeps,
): Promise<ChatResult> {
  const label = PROVIDER_LABEL[provider.kind];
  const url = buildUrl(provider.baseUrl, "chat/completions");
  const headers = buildHeaders(provider);

  let response: Response | null = null;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildChatBody(provider, req, true)),
      signal: req.signal,
    });
  } catch (e) {
    if (isAbort(e) || req.signal?.aborted) throw new ProviderError("Generation stopped.", "abort");
    // CORS or a network failure: retry once without streaming (requestUrl ignores CORS).
    return nonStreaming(provider, req, cb, deps, e);
  }

  if (!response.ok) {
    throw describeHttpError(label, response.status, await response.text().catch(() => ""));
  }
  if (!response.body) return nonStreaming(provider, req, cb, deps, new Error("streaming not supported"));

  const result: ChatResult = { text: "", reasoning: "", streamed: true };
  const sse = new SseParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  const handle = (payload: string): boolean => {
    if (payload.trim() === "[DONE]") return true;
    let parsed: ParsedChunk;
    try {
      parsed = parseCompletion(JSON.parse(payload));
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      return false; // ignore unparseable keep-alive lines
    }
    if (parsed.text) {
      result.text += parsed.text;
      cb.onText?.(parsed.text);
    }
    if (parsed.reasoning) {
      result.reasoning += parsed.reasoning;
      cb.onReasoning?.(parsed.reasoning);
    }
    if (parsed.usage) result.usage = parsed.usage;
    if (parsed.finishReason) result.finishReason = parsed.finishReason;
    return false;
  };

  try {
    let done = false;
    while (!done) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
        if (handle(payload)) {
          done = true;
          break;
        }
      }
    }
    if (!done) for (const payload of sse.flush()) handle(payload);
  } catch (e) {
    if (isAbort(e) || req.signal?.aborted) throw new ProviderError("Generation stopped.", "abort");
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`${label} stream failed: ${e instanceof Error ? e.message : String(e)}`, "stream");
  }

  if (!result.text.trim()) {
    throw new ProviderError(
      `${label} returned no text${result.finishReason ? ` (finish_reason: ${result.finishReason})` : ""}` +
        (result.reasoning ? ". The model produced only reasoning; try a larger Max tokens." : "."),
      "empty",
    );
  }
  return result;
}

async function nonStreaming(
  provider: ProviderConfig,
  req: ChatRequest,
  cb: ChatCallbacks,
  deps: ClientDeps,
  streamError: unknown,
): Promise<ChatResult> {
  const label = PROVIDER_LABEL[provider.kind];
  let res: SimpleResponse;
  try {
    res = await deps.request({
      url: buildUrl(provider.baseUrl, "chat/completions"),
      method: "POST",
      headers: buildHeaders(provider),
      body: JSON.stringify(buildChatBody(provider, req, false)),
    });
  } catch (e) {
    throw unreachable(provider, e instanceof Error && e.message ? e : streamError);
  }
  if (req.signal?.aborted) throw new ProviderError("Generation stopped.", "abort");
  if (res.status < 200 || res.status >= 300) throw describeHttpError(label, res.status, res.text);

  let parsed: ParsedChunk;
  try {
    parsed = parseCompletion(JSON.parse(res.text));
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`${label} returned a response that is not valid JSON: ${res.text.slice(0, 300)}`, "http", res.status, res.text);
  }
  if (!parsed.text.trim()) {
    throw new ProviderError(
      `${label} returned no text${parsed.finishReason ? ` (finish_reason: ${parsed.finishReason})` : ""}.`,
      "empty",
      res.status,
      res.text,
    );
  }
  if (parsed.text) cb.onText?.(parsed.text);
  if (parsed.reasoning) cb.onReasoning?.(parsed.reasoning);
  return {
    text: parsed.text,
    reasoning: parsed.reasoning,
    usage: parsed.usage,
    finishReason: parsed.finishReason,
    streamed: false,
  };
}

export async function fetchModels(provider: ProviderConfig, deps: ClientDeps): Promise<ModelInfo[]> {
  const label = PROVIDER_LABEL[provider.kind];
  const headers = buildHeaders(provider);
  delete headers["Content-Type"];
  let res: SimpleResponse;
  try {
    res = await deps.request({ url: buildUrl(provider.baseUrl, "models"), method: "GET", headers });
  } catch (e) {
    throw unreachable(provider, e);
  }
  if (res.status < 200 || res.status >= 300) throw describeHttpError(label, res.status, res.text);
  let json: { data?: unknown };
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new ProviderError(`${label} returned a model list that is not valid JSON: ${res.text.slice(0, 200)}`, "http", res.status);
  }
  const data = Array.isArray(json.data) ? json.data : [];
  const models: ModelInfo[] = [];
  for (const item of data) {
    const m = item as Record<string, unknown>;
    if (typeof m.id !== "string") continue;
    models.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : undefined,
      contextLength: typeof m.context_length === "number" ? m.context_length : undefined,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
