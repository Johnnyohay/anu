import { z } from "zod/v4";
import { SECTOR_IDS, UPDATE_TYPES } from "./schema.ts";
import type { Desk } from "./store.ts";
import { findCompanies, getBrief, getSector, listIdeas, overview, searchResearch, searchUpdates, upcomingEvents } from "./kb.ts";
import { searchPapers } from "./papers.ts";

// ANU's lookup tools over the data, with no server dependencies, so the local server
// (wrapped for Claude via betaZodTool, or sent to an open model) and the in-browser app
// use the same definitions.

export interface Evidence {
  id: string;
  date: string;
  title: string;
  source: string | null;
}

export interface ToolSpec<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  run: (input: I) => Promise<string>;
}

const spec = <S extends z.ZodType>(t: { name: string; description: string; inputSchema: S; run: (input: z.infer<S>) => Promise<string> }): ToolSpec => t;

export const Sector = z.enum(SECTOR_IDS);
const json = (v: unknown) => JSON.stringify(v);

export interface ToolOptions {
  /** Adds the Hugging Face Papers search tool. */
  papers?: boolean;
  /** Update id → similarity to a query, from the semantic index (server only). */
  similarities?: (query: string) => Promise<Map<string, number>>;
}

export function toolSpecs(desk: Desk, opts: ToolOptions, onEvidence: (items: Evidence[]) => void): ToolSpec[] {
  const report = (updates: { id: string; date: string; title: string; source: string | null }[]) =>
    onEvidence(updates.map(({ id, date, title, source }) => ({ id, date, title, source })));

  const tools: ToolSpec[] = [
    spec({
      name: "overview",
      description: "The big picture: the headline thesis, the forces moving the industry, how much data is stored and the 20 sectors with their ids. Call this first when you need orientation.",
      inputSchema: z.object({}),
      run: async () => json(overview(desk)),
    }),
    spec({
      name: "search_updates",
      description: `Search the dated, sourced news updates (contracts, funding, policy, milestones, deals). Every filter is optional. ${opts.similarities ? "Results are ranked by meaning and keywords together, so concept queries work." : "Results are ranked by keyword match, then newest first."}`,
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
        const result = searchUpdates(desk, input, opts.similarities && input.query ? await opts.similarities(input.query) : undefined);
        report(result.updates);
        return json(result);
      },
    }),
    spec({
      name: "get_sector",
      description: "Everything on one sector: its current state, where the money is, what to watch, recent updates, companies, upcoming events and research.",
      inputSchema: z.object({ id: Sector }),
      run: async ({ id }) => {
        const result = getSector(desk, id);
        if ("recentUpdates" in result) report(result.recentUpdates);
        return json(result);
      },
    }),
    spec({
      name: "find_companies",
      description: "Company directory: type (prime, new entrant, startup), HQ, status, competitive edge and latest news.",
      inputSchema: z.object({ query: z.string().optional(), sector: Sector.optional(), limit: z.number().int().optional() }),
      run: async (input) => json(findCompanies(desk, input)),
    }),
    spec({
      name: "upcoming_events",
      description: "Dated upcoming events: budget deadlines, decisions, earnings, launches and reports due.",
      inputSchema: z.object({ sector: Sector.optional(), days: z.number().int().optional().describe("Look-ahead window, default 120") }),
      run: async (input) => json(upcomingEvents(desk, input)),
    }),
    spec({
      name: "search_research",
      description: "Research library: think-tank reports, budget documents, filings and data sources, each with why it is worth reading.",
      inputSchema: z.object({ query: z.string().optional(), sector: Sector.optional(), limit: z.number().int().optional() }),
      run: async (input) => json(searchResearch(desk, input)),
    }),
    spec({
      name: "list_ideas",
      description: "Build ideas already identified: what it is, why now, capital needed, time to revenue and how crowded it is.",
      inputSchema: z.object({ sector: Sector.optional() }),
      run: async (input) => json(listIdeas(desk, input)),
    }),
    spec({
      name: "get_brief",
      description: "A daily morning brief. Omit date for the latest.",
      inputSchema: z.object({ date: z.string().optional().describe("YYYY-MM-DD") }),
      run: async ({ date }) => json(getBrief(desk, date)),
    }),
  ];
  if (opts.papers)
    tools.push(
        spec({
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
    );
  return tools;
}
