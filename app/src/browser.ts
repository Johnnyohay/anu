import { getBrief, getSector, overview, searchUpdates, upcomingEvents } from "../../src/kb.ts";
import { MODES } from "../../src/prompts.ts";
import { searchPapers } from "../../src/papers.ts";
import type { Desk } from "../../src/store.ts";
import type { Api, AskEvent, AskRequest, CompanyDetail, Meta, Paper, SectorDetail } from "./api.ts";

// ANU for the static GitHub Pages build (VITE_STATIC=1). Browsing (sectors, companies,
// briefs, papers) runs in the page from the site's JSON API. Questions are answered on
// GitHub for free: see ask() below and .github/workflows/ask.yml. Nothing is saved on
// the device, and nothing here costs money.

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

const REPO = "Johnnyohay/anu";
const BOT_MARK = "<!-- anu-answer -->";
const POLL_MS = 15000;
const WAIT_LIMIT_MS = 10 * 60 * 1000;

interface IssueComment {
  body: string;
  html_url: string;
}

// Public GitHub API: no login or token needed for reading a public repo's issues.
async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers: { accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(res.status === 403 ? "GitHub's public API limit was reached; open the issue on GitHub to read the answer." : `GitHub API error ${res.status}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Stopped", "AbortError"))), { once: true });
  });

/** The answer part of ANU's GitHub reply (the fact-check, sources and Grok prompt follow in <details>). */
const answerPart = (body: string) => body.replace(BOT_MARK, "").split("<details>")[0].trim();

/**
 * Asking happens on GitHub, where answering is free: this opens a pre-filled "Ask ANU"
 * issue (you click Submit), then waits for ANU's reply comment and shows it here.
 * conversationId is the issue number; follow-ups are asked as comments on that issue.
 */
async function* ask(body: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const started = new Date(Date.now() - 60000).toISOString();
  const question = body.question.trim();

  if (body.conversationId) {
    // Follow-up: GitHub can't pre-fill a comment, so copy the question and open the issue.
    await navigator.clipboard.writeText(question).catch(() => {});
    window.open(`https://github.com/${REPO}/issues/${body.conversationId}#new_comment_field`, "_blank", "noopener");
    yield { event: "start", data: { conversationId: body.conversationId } };
    yield { event: "status", data: { note: "Your follow-up is copied. On GitHub, paste it as a comment and click Comment. Waiting for ANU's reply…" } };
  } else {
    const f = body.focus;
    const details = [
      `Mode: ${f.mode}`,
      f.sector && `Sector id: ${f.sector}`,
      f.company && `Company id: ${f.company}`,
      f.days && `Days: ${f.days}`,
    ].filter(Boolean);
    const url = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`Ask ANU: ${question.slice(0, 200)}`)}&body=${encodeURIComponent(`${question}\n\n---\n${details.join("\n")}`)}`;
    // Opened before any await, so the browser treats it as part of the click.
    const tab = window.open(url, "_blank", "noopener");
    yield { event: "status", data: { note: tab === null ? `Your browser blocked the new tab. Open this link and click Submit: ${url}` : "On the GitHub tab, click Submit new issue. ANU answers there within about a minute, and the answer appears here too." } };
  }

  const deadline = Date.now() + WAIT_LIMIT_MS;
  let issue = body.conversationId ? Number(body.conversationId) : 0;
  let seen = 0;
  if (issue) seen = (await gh<IssueComment[]>(`issues/${issue}/comments?per_page=100`)).filter((c) => c.body.includes(BOT_MARK)).length;

  while (Date.now() < deadline) {
    await sleep(POLL_MS, signal);
    if (!issue) {
      const recent = await gh<{ number: number; title: string; created_at: string }[]>(`issues?state=all&sort=created&direction=desc&per_page=10&since=${started}`);
      const match = recent.find((i) => i.title.startsWith("Ask ANU:") && i.created_at >= started && i.title.includes(question.slice(0, 60)));
      if (!match) continue;
      issue = match.number;
      yield { event: "start", data: { conversationId: String(issue) } };
      yield { event: "status", data: { note: `Question received as issue #${issue}. ANU is answering…` } };
    }
    const replies = (await gh<IssueComment[]>(`issues/${issue}/comments?per_page=100`)).filter((c) => c.body.includes(BOT_MARK));
    if (replies.length > seen) {
      const reply = replies.at(-1)!;
      yield { event: "text", data: { text: `${answerPart(reply.body)}\n\n[Fact-check, sources and the Grok prompt are in the full reply on GitHub](${reply.html_url})` } };
      yield { event: "done", data: { stopReason: "end_turn", refusalCategory: null } };
      return;
    }
  }
  yield { event: "error", data: { message: `No reply yet. ${issue ? `Check issue #${issue} on GitHub` : "Make sure the issue was submitted on GitHub"}; ANU's reply will be there.` } };
}

/** The Grok prompt ANU put in its latest reply on the issue. */
async function grokPromptFromIssue(conversationId: string): Promise<string> {
  const reply = (await gh<IssueComment[]>(`issues/${conversationId}/comments?per_page=100`)).filter((c) => c.body.includes(BOT_MARK)).at(-1);
  const prompt = reply && /```text\n([\s\S]*?)\n```/.exec(reply.body)?.[1];
  if (!prompt) throw new Error("ANU's reply doesn't include a Grok prompt yet.");
  return prompt;
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
      engine: { engine: "github", model: "GitHub Models", label: "GitHub Models, answered on GitHub (free)", web: false },
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
  grokPrompt: grokPromptFromIssue,
  verify: () => Promise.reject(new Error("The fact-check is included in ANU's reply on GitHub.")),
  reset: async () => new Response(null),
  ask,
};
