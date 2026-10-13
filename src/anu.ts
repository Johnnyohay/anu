import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { SECTOR_IDS, UPDATE_TYPES } from "./schema.ts";
import type { Desk } from "./store.ts";
import { findCompanies, getBrief, getSector, listIdeas, overview, searchResearch, searchUpdates, upcomingEvents } from "./kb.ts";
import { KINDS, related, semanticSearch, updateSimilarities, type SemanticIndex } from "./semantic.ts";
import { searchPapers } from "./hf.ts";

// The ANU agent: Claude with read-only tools over data/. Used by the command line
// (src/agent.ts) and the web app's server (src/server.ts).

const MODEL = "claude-opus-5-5";
const client = new Anthropic();

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

export interface RunResult {
  history: Anthropic.Beta.BetaMessageParam[];
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
- Anything beyond the stored data is labelled "(general knowledge, may be outdated)"${web ? ", unless you found it with web search, in which case cite the page" : ""}.
- Teach as you go: explain acronyms, programs, budget terms and how buying works in plain words the first time they come up. Connect developments across sectors when it helps.
- When Johnny asks for advice (what to build, where to focus, who the buyer is), be direct: give a recommendation, the buyer and budget line, the incumbents, why now, the risks and a first step. Say plainly when the evidence is thin.
- Keep it skimmable: short paragraphs, "- " bullets and **bold** lead-ins, real numbers and names. No tables.

The stored data covers updates up to ${overview(desk).updatesCover?.to ?? "unknown"}.`;
}

/** Runs one user turn to completion and returns the full history (tool turns included) for follow-ups. */
export async function runAnu(
  desk: Desk,
  messages: Anthropic.Beta.BetaMessageParam[],
  opts: RunOptions = {},
  on: RunHandlers = {},
  signal?: AbortSignal,
): Promise<RunResult> {
  const web = !!opts.web;
  const tools = makeTools(desk, opts, (items) => on.onEvidence?.(items));
  const runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
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
  if (err instanceof Anthropic.AuthenticationError) return "No valid Claude API credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Wait a minute and ask again.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  // Thrown by the client before any request when no credentials are configured at all.
  if (err instanceof Error && /authentication method/i.test(err.message)) return "No Claude API key found. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart ANU.";
  return null;
}
