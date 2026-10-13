import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Ollama, type Message as OllamaMessage, type Tool as OllamaTool } from "ollama";
import { z } from "zod/v4";
import { SECTOR_IDS, UPDATE_TYPES } from "./schema.ts";
import type { Desk } from "./store.ts";
import { findCompanies, getBrief, getSector, listIdeas, overview, searchResearch, searchUpdates, upcomingEvents } from "./kb.ts";
import { KINDS, related, semanticSearch, updateSimilarities, type SemanticIndex } from "./semantic.ts";
import { searchPapers } from "./hf.ts";

// The ANU agent: a language model with read-only tools over data/. Used by the command
// line (src/agent.ts) and the web app's server (src/server.ts).
//
// Two engines run the same tools:
// - "ollama" (default): a free open-source model on this computer via Ollama. No account,
//   no key, nothing leaves the machine. Model: OLLAMA_MODEL (default qwen3.5:9b).
// - "claude": the paid Claude API, used only when ANTHROPIC_API_KEY is set (or ANU_ENGINE=claude).

export type Engine = "ollama" | "claude";
export const ENGINE: Engine =
  process.env.ANU_ENGINE === "claude" || process.env.ANU_ENGINE === "ollama"
    ? process.env.ANU_ENGINE
    : process.env.ANTHROPIC_API_KEY
      ? "claude"
      : "ollama";

const CLAUDE_MODEL = "claude-opus-5-5";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const OLLAMA_MAX_STEPS = 12;
// Tool results are trimmed so a small model's context window isn't swamped.
const OLLAMA_TOOL_RESULT_CHARS = 12000;

/** What the app shows about the engine, and whether web search is available with it. */
export const engineInfo = () =>
  ENGINE === "claude"
    ? { engine: ENGINE, model: CLAUDE_MODEL, label: "Claude API (paid)", web: true }
    : { engine: ENGINE, model: OLLAMA_MODEL, label: `Local model: ${OLLAMA_MODEL} (free)`, web: false };

export type Effort = "low" | "medium" | "high";

export interface Evidence {
  id: string;
  date: string;
  title: string;
  source: string | null;
}

export interface RunHandlers {
  onText?: (text: string) => void;
  onTool?: (name: string, input: unknown) => void;
  onEvidence?: (items: Evidence[]) => void;
}

export interface RunOptions {
  web?: boolean;
  /** Lets ANU search Hugging Face Papers (free) for technical research. */
  papers?: boolean;
  effort?: Effort;
  /** Semantic index from src/semantic.ts; without it, search is keyword-only. */
  index?: SemanticIndex;
}

/** A conversation turn in the active engine's format; the server stores and replays it as-is. */
export type ChatMessage = Anthropic.Beta.BetaMessageParam | OllamaMessage;

export interface RunResult {
  history: ChatMessage[];
  stopReason: string | null;
  refusalCategory?: string | null;
}

const Sector = z.enum(SECTOR_IDS);
const json = (v: unknown) => JSON.stringify(v);

function makeTools(desk: Desk, opts: RunOptions, onEvidence: (items: Evidence[]) => void) {
  const index = opts.index;
  const report = (updates: { id: string; date: string; title: string; source: string | null }[]) =>
    onEvidence(updates.map(({ id, date, title, source }) => ({ id, date, title, source })));

  const tools = [
    betaZodTool({
      name: "overview",
      description: "The big picture: the headline thesis, the forces moving the industry, how much data is stored and the 20 sectors with their ids. Call this first when you need orientation.",
      inputSchema: z.object({}),
      run: async () => json(overview(desk)),
    }),
    betaZodTool({
      name: "search_updates",
      description: `Search the dated, sourced news updates (contracts, funding, policy, milestones, deals). Every filter is optional. ${index ? "Results are ranked by meaning and keywords together, so concept queries work." : "Results are ranked by keyword match, then newest first."}`,
      inputSchema: z.object({
        query: z.string().optional().describe("Keywords, e.g. 'hypersonic test' or 'Golden Dome'"),
        sectors: z.array(Sector).optional(),
        type: z.enum(UPDATE_TYPES).optional(),
        company: z.string().optional().describe("Company name, e.g. 'Anduril'"),
        since: z.string().optional().describe("YYYY-MM-DD"),
        until: z.string().optional().describe("YYYY-MM-DD"),
        limit: z.number().int().optional().describe("Default 15, max 50"),
      }),
      run: async (input) => {
        const result = searchUpdates(desk, input, index && input.query ? await updateSimilarities(index, input.query) : undefined);
        report(result.updates);
        return json(result);
      },
    }),
    betaZodTool({
      name: "get_sector",
      description: "Everything on one sector: its current state, where the money is, what to watch, recent updates, companies, upcoming events and research.",
      inputSchema: z.object({ id: Sector }),
      run: async ({ id }) => {
        const result = getSector(desk, id);
        if ("recentUpdates" in result) report(result.recentUpdates);
        return json(result);
      },
    }),
    betaZodTool({
      name: "find_companies",
      description: "Company directory: type (prime, new entrant, startup), HQ, status, competitive edge and latest news.",
      inputSchema: z.object({ query: z.string().optional(), sector: Sector.optional(), limit: z.number().int().optional() }),
      run: async (input) => json(findCompanies(desk, input)),
    }),
    betaZodTool({
      name: "upcoming_events",
      description: "Dated upcoming events: budget deadlines, decisions, earnings, launches and reports due.",
      inputSchema: z.object({ sector: Sector.optional(), days: z.number().int().optional().describe("Look-ahead window, default 120") }),
      run: async (input) => json(upcomingEvents(desk, input)),
    }),
    betaZodTool({
      name: "search_research",
      description: "Research library: think-tank reports, budget documents, filings and data sources, each with why it is worth reading.",
      inputSchema: z.object({ query: z.string().optional(), sector: Sector.optional(), limit: z.number().int().optional() }),
      run: async (input) => json(searchResearch(desk, input)),
    }),
    betaZodTool({
      name: "list_ideas",
      description: "Build ideas already identified: what it is, why now, capital needed, time to revenue and how crowded it is.",
      inputSchema: z.object({ sector: Sector.optional() }),
      run: async (input) => json(listIdeas(desk, input)),
    }),
    betaZodTool({
      name: "get_brief",
      description: "A daily morning brief. Omit date for the latest.",
      inputSchema: z.object({ date: z.string().optional().describe("YYYY-MM-DD") }),
      run: async ({ date }) => json(getBrief(desk, date)),
    }),
  ];

  const semanticTools = index
    ? [
        betaZodTool({
          name: "semantic_search",
          description: "Find anything in the knowledge base by meaning, across updates, companies, research, build ideas and sectors. Best for concepts and questions phrased in your own words (e.g. 'cheap ways to stop drone swarms'). Each result has a similarity from 0 to 1; below about 0.6 is weak.",
          inputSchema: z.object({
            query: z.string(),
            kinds: z.array(z.enum(KINDS)).optional().describe("Limit to these kinds of item"),
            sector: Sector.optional(),
            since: z.string().optional().describe("YYYY-MM-DD; applies to updates"),
            limit: z.number().int().optional().describe("Default 12, max 40"),
          }),
          run: async (input) => {
            const results = await semanticSearch(desk, index, input);
            report(results.filter((r) => r.kind === "update").map((r) => r.item as Evidence));
            return json(results);
          },
        }),
        betaZodTool({
          name: "related_updates",
          description: "The updates most similar in meaning to one item (an update, company, research, idea or sector id): other coverage of the same story, or the news most relevant to that company or idea.",
          inputSchema: z.object({ id: z.string(), limit: z.number().int().optional() }),
          run: async ({ id, limit }) => {
            const result = related(desk, index, id, limit);
            if (Array.isArray(result)) report(result.map((r) => r.update as Evidence));
            return json(result);
          },
        }),
      ]
    : [];

  const paperTools = opts.papers
    ? [
        betaZodTool({
          name: "search_papers",
          description: "Search Hugging Face Papers: recent arXiv research (AI, autonomy, robotics, computer vision, RF and sensing, cyber, materials) with community upvotes. Use it to explain the technology behind a trend or to see what is technically possible now. Results are research, not news: say so when you use them.",
          inputSchema: z.object({
            query: z.string().describe("Technical topic, e.g. 'drone swarm coordination' or 'synthetic aperture radar target detection'"),
            since: z.string().optional().describe("YYYY-MM-DD, only papers published on or after"),
            limit: z.number().int().optional().describe("Default 8, max 20"),
          }),
          run: async (input) => {
            try {
              const papers = await searchPapers(input.query, input);
              onEvidence(papers.map((p) => ({ id: `paper-${p.id}`, date: p.published, title: p.title, source: `Hugging Face Papers [research] ${p.url}` })));
              return json(papers);
            } catch (err) {
              return json({ error: err instanceof Error ? err.message : String(err) });
            }
          },
        }),
      ]
    : [];

  return [...tools, ...semanticTools, ...paperTools].map((t) => ({ ...t, eager_input_streaming: true }));
}

function systemPrompt(desk: Desk, opts: RunOptions) {
  const web = !!opts.web;
  return `You are ANU, Johnny's personal helper for learning about and keeping up with the defense-technology industry. Johnny is a founder who is learning this industry, wants to understand where it is going, and wants to find something worth building.

Your knowledge base is the data in this repo, reachable through your tools: sourced news updates, 20 sector briefs, a company directory, upcoming events, a research library, build ideas and daily briefs. Look things up before answering; search more than once when the first results are thin.${opts.index ? " semantic_search finds items by meaning, so use it for concepts and for questions in everyday words." : ""}${opts.papers ? " search_papers finds technical research (arXiv via Hugging Face) when Johnny wants to understand how a technology works or where it is heading; label it as research, not news, and cite the paper." : ""}

A question may start with a bracketed focus line set in Johnny's app (mode, sector, company, time range). Treat it as the scope of the question and follow the mode's instruction.

How to answer:
- Ground claims in the tools' results and name the source after each one, e.g. [Breaking Defense] or [SEC 8-K]. Sources marked [aggregator] are unconfirmed; say so when you rely on one.
- Never guess names, founders, dates or numbers. If a fact is not in the tool results, look it up or leave it out; do not fill gaps from memory unless you label it.
- Anything beyond the stored data is labelled "(general knowledge, may be outdated)"${web ? ", unless you found it with web search, in which case cite the page" : ""}.
- Teach as you go: explain acronyms, programs, budget terms and how buying works in plain words the first time they come up. Connect developments across sectors when it helps.
- When Johnny asks for advice (what to build, where to focus, who the buyer is), be direct: give a recommendation, the buyer and budget line, the incumbents, why now, the risks and a first step. Say plainly when the evidence is thin.
- Keep it skimmable: short paragraphs, "- " bullets and **bold** lead-ins, real numbers and names. No tables.

The stored data covers updates up to ${overview(desk).updatesCover?.to ?? "unknown"}.`;
}

/** Runs one user turn to completion and returns the full history (tool turns included) for follow-ups. */
export function runAnu(desk: Desk, messages: ChatMessage[], opts: RunOptions = {}, on: RunHandlers = {}, signal?: AbortSignal): Promise<RunResult> {
  return ENGINE === "claude"
    ? runClaude(desk, messages as Anthropic.Beta.BetaMessageParam[], opts, on, signal)
    : runOllama(desk, messages as OllamaMessage[], { ...opts, web: false }, on, signal);
}

interface PortableTool {
  name: string;
  description: string;
  input_schema: unknown;
  parse: (input: unknown) => unknown;
  run: (input: unknown) => Promise<unknown> | unknown;
}

/**
 * Small local models often send arrays and numbers as strings ('["update"]', "15").
 * Validate as sent first; if that fails, decode such strings and validate again.
 */
function parseLenient(tool: PortableTool, args: Record<string, unknown>): unknown {
  try {
    return tool.parse(args);
  } catch (err) {
    const decoded = Object.fromEntries(
      Object.entries(args).map(([k, v]) => {
        if (typeof v !== "string") return [k, v];
        if (/^\s*[[{]/.test(v)) {
          try {
            return [k, JSON.parse(v)];
          } catch {}
        }
        if (/^-?\d+(\.\d+)?$/.test(v.trim())) return [k, Number(v)];
        if (v === "") return [k, undefined];
        return [k, v];
      }),
    );
    try {
      return tool.parse(decoded);
    } catch {
      throw err;
    }
  }
}

async function runOllama(desk: Desk, messages: OllamaMessage[], opts: RunOptions, on: RunHandlers, signal?: AbortSignal): Promise<RunResult> {
  const ollama = new Ollama({ host: OLLAMA_HOST });
  // The same runnable tools the Claude engine uses, viewed through what this loop needs.
  const tools = makeTools(desk, opts, (items) => on.onEvidence?.(items)) as unknown as PortableTool[];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const defs: OllamaTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema as OllamaTool["function"]["parameters"] },
  }));
  const system: OllamaMessage = { role: "system", content: systemPrompt(desk, opts) };
  const history = [...messages];

  for (let step = 0; step < OLLAMA_MAX_STEPS; step++) {
    const stream = await ollama.chat({
      model: OLLAMA_MODEL,
      messages: [system, ...history],
      tools: defs,
      stream: true,
      // Thinking makes answers better but slower; "Quick" depth turns it off.
      think: opts.effort !== "low",
      options: { num_ctx: 32768, temperature: 0.2 },
    });
    const stop = () => stream.abort();
    signal?.addEventListener("abort", stop);

    let content = "";
    const calls: NonNullable<OllamaMessage["tool_calls"]> = [];
    try {
      for await (const part of stream) {
        if (part.message.content) {
          content += part.message.content;
          on.onText?.(part.message.content);
        }
        if (part.message.tool_calls) calls.push(...part.message.tool_calls);
      }
    } finally {
      signal?.removeEventListener("abort", stop);
    }
    history.push({ role: "assistant", content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { history, stopReason: "end_turn" };
    if (content.trim()) on.onText?.("\n\n");

    for (const call of calls) {
      const { name, arguments: args } = call.function;
      on.onTool?.(name, args);
      const tool = byName.get(name);
      let result: string;
      try {
        const out = tool ? await tool.run(parseLenient(tool, args)) : json({ error: `Unknown tool "${name}". Available: ${[...byName.keys()].join(", ")}` });
        result = typeof out === "string" ? out : json(out);
      } catch (err) {
        result = json({ error: `Invalid call to ${name}: ${err instanceof Error ? err.message : String(err)}` });
      }
      if (result.length > OLLAMA_TOOL_RESULT_CHARS) result = result.slice(0, OLLAMA_TOOL_RESULT_CHARS) + "…(truncated; narrow the search for more)";
      history.push({ role: "tool", tool_name: name, content: result });
    }
  }
  return { history, stopReason: "max_steps" };
}

async function runClaude(desk: Desk, messages: Anthropic.Beta.BetaMessageParam[], opts: RunOptions, on: RunHandlers, signal?: AbortSignal): Promise<RunResult> {
  const client = new Anthropic();
  const web = !!opts.web;
  const tools = makeTools(desk, opts, (items) => on.onEvidence?.(items));
  const runner = client.beta.messages.toolRunner(
    {
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "high" },
      cache_control: { type: "ephemeral" },
      system: systemPrompt(desk, opts),
      tools: web ? [...tools, { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8 }] : tools,
      messages,
      max_iterations: 20,
      stream: true,
    },
    { signal },
  );

  let last: Anthropic.Beta.BetaMessage | undefined;
  for await (const stream of runner) {
    stream.on("text", (t) => on.onText?.(t));
    last = await stream.finalMessage();
    for (const b of last.content) {
      if (b.type === "tool_use" || b.type === "server_tool_use") on.onTool?.(b.name, b.input);
    }
    if (last.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: last.content });
  }

  const history = [...runner.params.messages];
  if (last && history[history.length - 1]?.role !== "assistant") history.push({ role: "assistant", content: last.content });
  return {
    history,
    stopReason: last?.stop_reason ?? null,
    refusalCategory: last?.stop_reason === "refusal" ? (last.stop_details?.category ?? null) : undefined,
  };
}

export function describeApiError(err: unknown): string | null {
  if (ENGINE === "ollama" && err instanceof Error) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED" || /fetch failed|ECONNREFUSED/i.test(err.message))
      return `Can't reach Ollama at ${OLLAMA_HOST}. Start it with \`brew services start ollama\` (or open the Ollama app), then ask again.`;
    if (/not found/i.test(err.message) && /model/i.test(err.message))
      return `The local model ${OLLAMA_MODEL} isn't downloaded yet. Run \`ollama pull ${OLLAMA_MODEL}\`, then ask again.`;
    if (err.name === "AbortError") return null;
    return `Local model error: ${err.message}`;
  }
  if (err instanceof Anthropic.AuthenticationError) return "No valid Claude API credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Wait a minute and ask again.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  // Thrown by the client before any request when no credentials are configured at all.
  if (err instanceof Error && /authentication method/i.test(err.message)) return "No Claude API key found. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart ANU.";
  return null;
}
