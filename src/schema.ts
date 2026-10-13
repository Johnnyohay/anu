import { z } from "zod/v4";

// Sector ids are fixed: the site, the API and the daily pipeline all key on them.
export const SECTOR_IDS = [
  "ai", "air", "sea", "ground", "space", "missiledef", "strike", "cuas", "ew", "cyber",
  "sensing", "mfg", "minerals", "energy", "bio", "policy", "capital", "primes", "global", "adversary",
] as const;

export const UPDATE_TYPES = [
  "Contract", "Funding", "Policy & budget", "Tech milestone", "M&A & IPO", "Earnings", "Conflict & allies", "Research",
] as const;

const SectorId = z.enum(SECTOR_IDS);

const Source = z.object({
  t: z.string().describe("Publication or organization name, e.g. 'Breaking Defense'"),
  u: z.string().describe("Full https URL of the article or document"),
  q: z.enum(["primary", "news", "research", "aggregator"]).describe(
    "primary = filings, company or government releases; news = reported journalism; research = think tanks, CRS, data providers; aggregator = secondary compilations",
  ),
});

const UpdateDraft = z.object({
  d: z.string().describe("Date the event happened, YYYY-MM-DD"),
  title: z.string().describe("Plain-language headline, under 110 characters"),
  body: z.string().describe("One or two sentences on what happened"),
  why: z.string().describe("One sentence on why it matters to someone building in defense tech"),
  sectors: z.array(SectorId),
  type: z.enum(UPDATE_TYPES),
  companies: z.array(z.string()),
  src: Source,
});

const Story = z.object({
  tag: z.string().describe("Short topic label, e.g. 'Counter-drone'"),
  h: z.string().describe("Headline a non-expert understands"),
  what: z.string().describe("One or two plain sentences. Few numbers, no acronyms without explanation."),
  you: z.string().describe("Why it matters to a founder who wants to get ahead and maybe build something"),
  updateIndex: z.number().int().describe("Index into the updates array of the update this story is based on"),
});

const Catalyst = z.object({
  d: z.string().describe("YYYY-MM-DD; use the 15th or last day of the month when only the month is known"),
  approx: z.boolean(),
  title: z.string(),
  sectors: z.array(SectorId),
  why: z.string(),
});

export const DailyOutput = z.object({
  updates: z.array(UpdateDraft).describe("New, significant developments not already on the desk, newest first"),
  brief: z.object({
    title: z.string().describe("A short headline for the day"),
    big: z.string().describe("One or two sentences: the big picture today"),
    stories: z.array(Story).describe("Three to five stories, most important first"),
    watch: z.object({ h: z.string(), why: z.string() }).describe("The one thing to keep an eye on"),
    idea: z.object({ h: z.string(), why: z.string() }).describe("One concrete thing a founder could build, grounded in today's news"),
  }),
  newCatalysts: z.array(Catalyst).describe("New dated upcoming events (deadlines, decisions, launches) not already listed"),
});

export type DailyOutput = z.infer<typeof DailyOutput>;
export type UpdateDraft = z.infer<typeof UpdateDraft>;
export type Update = UpdateDraft & { id: string; dApprox?: boolean; addedAt?: string };
export type Catalyst = z.infer<typeof Catalyst> & { id: string };
export interface Sector { id: string; order: number; name: string; heat: number; state: string; money: string; watch: string }
export interface Brief {
  date: string;
  title: string;
  big: string;
  stories: { tag: string; h: string; what: string; you: string; ref: string }[];
  watch: { h: string; why: string };
  idea: { h: string; why: string };
}
