// Minimal client for OpenAI-compatible chat APIs: Groq (free tier), xAI Grok, and
// Ollama's /v1 endpoint. Free tiers cap tokens per minute, so a 429 waits for the
// time the provider asks for and retries instead of failing the answer.

export interface Provider {
  id: "groq" | "xai" | "ollama";
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export const PROVIDERS = {
  groq: (model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"): Provider => ({
    id: "groq",
    label: `${model} on Groq (free tier)`,
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY,
    model,
  }),
  xai: (model = process.env.XAI_MODEL ?? "grok-4.3"): Provider => ({
    id: "xai",
    label: `${model} by xAI (paid)`,
    baseUrl: "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY,
    model,
  }),
  ollama: (model = process.env.OLLAMA_MODEL ?? "qwen3.5:9b"): Provider => ({
    id: "ollama",
    label: `${model} on this computer (free)`,
    baseUrl: `${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"}/v1`,
    model,
  }),
};

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const MAX_WAITS = 4;

export async function chat(
  p: Provider,
  body: { messages: ChatMsg[]; tools?: ToolDef[]; json?: boolean; temperature?: number; reasoningEffort?: "low" | "medium" | "high" },
  opts: { signal?: AbortSignal; onWait?: (seconds: number) => void } = {},
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      signal: opts.signal,
      headers: { "content-type": "application/json", ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) },
      body: JSON.stringify({
        model: p.model,
        messages: body.messages,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: "auto" } : {}),
        ...(body.json ? { response_format: { type: "json_object" } } : {}),
        ...(body.reasoningEffort && p.id === "groq" && p.model.startsWith("openai/gpt-oss") ? { reasoning_effort: body.reasoningEffort } : {}),
        temperature: body.temperature ?? 0.2,
      }),
    });

    if (res.status === 429 && attempt < MAX_WAITS) {
      const header = Number(res.headers.get("retry-after"));
      const seconds = Math.min(Number.isFinite(header) && header > 0 ? Math.ceil(header) : 15, 60);
      opts.onWait?.(seconds);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      const detail = /"message"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? text.slice(0, 300);
      throw new LlmError(`${p.label}: ${res.status} ${detail}`, res.status);
    }
    const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[] };
    const choice = data.choices[0];
    return { content: choice.message.content ?? "", toolCalls: choice.message.tool_calls ?? [], finishReason: choice.finish_reason };
  }
}
