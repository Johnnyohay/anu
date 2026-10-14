import type { Desk } from "./store.ts";
import { overview } from "./kb.ts";

// Instructions shared by every way ANU runs: the local server and the in-browser app.

export const MODES = {
  learn: { label: "Teach me", instruction: "Teach me this from the ground up: the basics, key terms and acronyms, the main players, how the money flows, and what to read next." },
  news: { label: "What's new", instruction: "Summarize the most important recent developments and explain why each one matters." },
  advise: { label: "Advise me", instruction: "Advise me as a founder: what is worth building or focusing on here? Give a direct recommendation with buyer, budget line, incumbents, why now, risks and a first step." },
  company: { label: "Company deep dive", instruction: "Deep dive on the company: what they sell, who buys it, their edge, recent news, competitors and where they are vulnerable." },
  compare: { label: "Compare", instruction: "Compare the options side by side in bullets and say which is stronger and why." },
} as const;
export type Mode = keyof typeof MODES;

export interface Focus {
  mode?: Mode;
  sector?: string;
  company?: string;
  days?: number;
}

export function focusLine(desk: Desk, f: Focus | undefined): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.mode && MODES[f.mode]) parts.push(`Mode: ${MODES[f.mode].label}. ${MODES[f.mode].instruction}`);
  const sector = desk.sectors.find((s) => s.id === f.sector);
  if (sector) parts.push(`Sector: ${sector.name} (${sector.id})`);
  const company = desk.companies.find((c) => c.id === f.company);
  if (company) parts.push(`Company: ${company.name}`);
  if (f.days) parts.push(`Time range: the last ${f.days} days (since ${new Date(Date.now() - f.days * 864e5).toISOString().slice(0, 10)})`);
  return parts.length ? `[Focus — ${parts.join(" · ")}]\n\n` : "";
}

export function systemPrompt(desk: Desk, opts: { web?: boolean; papers?: boolean; semantic?: boolean }) {
  const web = !!opts.web;
  return `You are ANU, Johnny's personal helper for learning about and keeping up with the defense-technology industry. Johnny is a founder who is learning this industry, wants to understand where it is going, and wants to find something worth building.

Your knowledge base is the data in this repo, reachable through your tools: sourced news updates, 20 sector briefs, a company directory, upcoming events, a research library, build ideas and daily briefs. Look things up before answering; search more than once when the first results are thin.${opts.semantic ? " semantic_search finds items by meaning, so use it for concepts and for questions in everyday words." : ""}${opts.papers ? " search_papers finds technical research (arXiv via Hugging Face) when Johnny wants to understand how a technology works or where it is heading; label it as research, not news, and cite the paper." : ""}

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
