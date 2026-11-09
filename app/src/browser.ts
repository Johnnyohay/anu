import { getBrief, getSector, overview, searchUpdates, upcomingEvents } from "../../src/kb.ts";
import { MODES } from "../../src/prompts.ts";
import { searchPapers } from "../../src/papers.ts";
import type { Desk } from "../../src/store.ts";
import type { Api, AskEvent, AskRequest, CompanyDetail, Meta, Paper, SectorDetail } from "./api.ts";

// ANU for the static GitHub Pages build (VITE_STATIC=1). Browsing (sectors, companies,
// briefs, papers) runs in the page from the site's JSON API. Nothing is saved on the
// device, and nothing here costs money. Questions hand off to Claude (see ask below).

const DATA_URL = import.meta.env.VITE_DATA_URL ?? new URL("../api/v1/all.json", location.href).href;
const SOURCES = { data: { label: "My data only", papers: false }, papers: { label: "Data + AI papers", papers: true } } as const;

let deskPromise: Promise<Desk> | null = null;
function loadDesk(): Promise<Desk> {
  deskPromise ??= fetch(DATA_URL, { cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error(`Couldn't load ANU's data (${res.status})`);
    return (await res.json()) as Desk;
  });
  deskPromise.catch(() => (deskPromise = null));
  return deskPromise;
}

// Asking on the website hands off to Claude (claude.ai, free with a Claude account, no key
// here). ANU searches its own data in the page, then builds a prompt with the question, its
// answering rules and the sourced evidence, ready to send in Claude.

const HOUSING_URL = new URL("../api/v1/housing-summary.json", DATA_URL).href;
/** claude.ai's ?q= prefill. Longer prompts go by clipboard instead of the address bar. */
export const CLAUDE_URL = "https://claude.ai/new";
const URL_MAX = 7500;
const prompts = new Map<string, string>();

const lines = (rows: (string | null | undefined | false)[]) => rows.filter(Boolean).join("\n");
const since = (days?: number) => (days ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : undefined);

async function housingBlock(): Promise<string> {
  try {
    const h = await (await fetch(HOUSING_URL, { cache: "no-store" })).json();
    const metro = (m: Record<string, number | string>) =>
      `- ${m.name}, ${m.state}: price $${Number(m.price).toLocaleString()}, rent $${m.rent}/mo, gross yield ${m.grossYield}%, cap rate ${m.capRate}%, cash flow $${m.cashFlow}/mo, rent ${m.rentYoY}% y/y, price ${m.priceYoY}% y/y, 12-month forecast ${m.forecast12m}%`;
    return lines([
      `US housing as of ${h.asOf}: 30-year mortgage ${h.mortgage.rate30}% (a year ago ${h.mortgage.rate30YearAgo}%), 15-year ${h.mortgage.rate15}%.`,
      `National typical home $${Number(h.national.price).toLocaleString()} (${h.national.priceYoY}% y/y), typical rent $${h.national.rent} (${h.national.rentYoY}% y/y), price forecast ${h.national.forecast12m}% over 12 months.`,
      "Best-scoring rental markets:", ...h.topScore.map(metro),
      "Highest gross yield:", ...h.topYield.map(metro),
    ]);
  } catch {
    return "";
  }
}

async function* ask(body: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const conversationId = body.conversationId ?? crypto.randomUUID();
  yield { event: "start", data: { conversationId } };
  const desk = await loadDesk();
  if (signal.aborted) return;
  const { mode, sector, company, days } = body.focus;
  const blocks: string[] = [];
  const evidence: { id: string; date: string; title: string; source: string | null }[] = [];

  const query = { query: body.question, sectors: sector ? [sector] : undefined, company, since: since(days), limit: 15 };
  yield { event: "tool", data: { name: "search_updates", input: { query: body.question, ...(sector && { sectors: [sector] }), ...(company && { company }) } } };
  let found = searchUpdates(desk, query).updates;
  if (found.length < 5) found = [...found, ...searchUpdates(desk, { ...query, query: undefined, limit: 10 }).updates.filter((u) => !found.some((f) => f.id === u.id))];
  const link = (src: string | null) => src?.match(/https?:\/\/\S+/)?.[0];
  const stories: string[] = [];
  for (const u of found) {
    evidence.push({ id: u.id, date: u.date, title: u.title, source: u.source });
    stories.push(lines([`[${u.date}] ${u.title}`, u.why && `Why it matters: ${u.why}`, link(u.source) && `Source: ${link(u.source)}`]));
  }

  if (sector) {
    yield { event: "tool", data: { name: "get_sector", input: { id: sector } } };
    const s = getSector(desk, sector);
    if (!("error" in s)) blocks.unshift(lines([`AREA NOTE: ${s.name}`, `State: ${s.state}`, `Money: ${s.money}`, `Watch: ${s.watch}`]));
  }
  if (mode === "invest" || /hous|home|rent|mortgage|metro|real estate/i.test(body.question)) {
    yield { event: "tool", data: { name: "get_housing", input: {} } };
    const h = await housingBlock();
    if (h) blocks.unshift(h);
  }
  const events = upcomingEvents(desk, { sector, days: 90 });
  if (events.length) blocks.push(lines(["COMING UP:", ...events.slice(0, 8).map((e) => `- ${e.d}${e.approx ? " (approx.)" : ""}: ${e.title}. ${e.why}`)]));

  yield { event: "evidence", data: { items: evidence } };

  const rule = MODES[(mode in MODES ? mode : "news") as keyof typeof MODES];
  const coming = blocks.filter((b) => b.startsWith("COMING UP"));
  const context = blocks.filter((b) => !b.startsWith("COMING UP"));
  const build = (n: number) => {
    const ev = [...context, ...stories.slice(0, n), ...coming].map((b, i) => `[${i + 1}] ${b}`).join("\n\n");
    return `You are ANU, my research guide on defense tech and US housing. Answer my question using the EVIDENCE below, which comes from ANU's sourced daily data.

Rules: ${rule.instruction} Write in plain words, explain any acronym the first time, and cite the evidence numbers like [3]. If the evidence doesn't cover something, say so and then add what you know, clearly marked as not from ANU's data.

QUESTION:
${body.question}

EVIDENCE (from ANU, data to ${desk.updates.map((u) => u.d).sort().at(-1)}):
${ev || "(nothing in ANU's data matched)"}`;
  };
  // Keep as many stories as fit in claude.ai's address bar, so Claude opens already filled in.
  let n = stories.length;
  while (n > 3 && encodeURIComponent(build(n)).length > URL_MAX) n--;
  const prompt = build(n);
  prompts.set(conversationId, prompt);

  yield {
    event: "text",
    data: {
      text: `ANU found **${evidence.length} sourced ${evidence.length === 1 ? "story" : "stories"}** for this${n < stories.length ? ` and packed the top ${n}` : ""}${context.length || coming.length ? ", plus area notes and upcoming dates," : ""} into a prompt for Claude. Press **Ask Claude (free)** below: Claude opens with your question, the evidence and ANU's answering rules filled in. Just press send.`,
    },
  };
  yield { event: "done", data: { stopReason: null, refusalCategory: null } };
}

export const browserApi: Api = {
  async meta(): Promise<Meta> {
    const desk = await loadDesk();
    return {
      overview: overview(desk) as Meta["overview"],
      sectors: [...desk.sectors].sort((a, b) => a.order - b.order),
      companies: desk.companies
        .map((c) => ({ id: String(c.id), name: String(c.name), sectors: (c.sectors as string[]) ?? [], type: String(c.type) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label })),
      sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label })),
      semantic: false,
      engine: { engine: "claude", model: "Claude", label: "Answered in Claude (free)", web: false },
      checker: null,
      brief: getBrief(desk) as Meta["brief"],
      upcoming: upcomingEvents(desk, { days: 60 }) as Meta["upcoming"],
    };
  },
  sector: async (id) => getSector(await loadDesk(), id) as SectorDetail,
  async company(id) {
    const desk = await loadDesk();
    const company = desk.companies.find((c) => c.id === id);
    if (!company) throw new Error("Unknown company");
    return { ...company, updates: searchUpdates(desk, { company: String(company.name), limit: 12 }).updates } as unknown as CompanyDetail;
  },
  papers: (q, limit = 5) => searchPapers(q, { limit }) as Promise<Paper[]>,
  async grokPrompt(id) {
    const p = prompts.get(id);
    if (!p) throw new Error("Ask a question first.");
    return p;
  },
  verify: () => Promise.reject(new Error("The fact-check is included in ANU's reply on GitHub.")),
  reset: async () => new Response(null),
  ask,
};
