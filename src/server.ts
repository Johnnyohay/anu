import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { loadDesk } from "./store.ts";
import { getBrief, getSector, overview, searchUpdates, upcomingEvents } from "./kb.ts";
import { describeApiError, runAnu, type Effort } from "./anu.ts";
import { buildIndex, type SemanticIndex } from "./semantic.ts";
import { searchPapers } from "./hf.ts";

// Local server for the ANU app: serves the React UI from app-dist/, free data
// endpoints from data/, and streams agent answers over server-sent events.
// Runs on your machine only, so the Claude API key never reaches a browser.

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = "app-dist";
const desk = await loadDesk();
const conversations = new Map<string, Anthropic.Beta.BetaMessageParam[]>();

// Semantic search runs on a local Hugging Face model; if it can't load, ANU falls back to keywords.
let index: SemanticIndex | undefined;
try {
  index = await buildIndex(desk, console.log);
  console.log(`Semantic index ready: ${index.docs.length} items.`);
} catch (err) {
  console.warn(`Semantic search off (${err instanceof Error ? err.message : err}); using keyword search.`);
}

export const SOURCES = {
  data: { label: "My data only", papers: false, web: false },
  papers: { label: "Data + AI papers", papers: true, web: false },
  all: { label: "Data + papers + web", papers: true, web: true },
} as const;
type SourceId = keyof typeof SOURCES;

export const MODES = {
  learn: { label: "Teach me", instruction: "Teach me this from the ground up: the basics, key terms and acronyms, the main players, how the money flows, and what to read next." },
  news: { label: "What's new", instruction: "Summarize the most important recent developments and explain why each one matters." },
  advise: { label: "Advise me", instruction: "Advise me as a founder: what is worth building or focusing on here? Give a direct recommendation with buyer, budget line, incumbents, why now, risks and a first step." },
  company: { label: "Company deep dive", instruction: "Deep dive on the company: what they sell, who buys it, their edge, recent news, competitors and where they are vulnerable." },
  compare: { label: "Compare", instruction: "Compare the options side by side in bullets and say which is stronger and why." },
} as const;
type Mode = keyof typeof MODES;

interface AskBody {
  conversationId?: string;
  question: string;
  focus?: { mode?: Mode; sector?: string; company?: string; days?: number };
  effort?: Effort;
  sources?: SourceId;
}

function focusLine(f: AskBody["focus"]): string {
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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody<T>(req: http.IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}") as T;
}

function companyDetail(id: string) {
  const company = desk.companies.find((c) => c.id === id);
  if (!company) return null;
  const name = String(company.name);
  return { ...company, updates: searchUpdates(desk, { company: name, limit: 12 }).updates };
}

async function ask(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readBody<AskBody>(req);
  if (!body.question?.trim()) return sendJson(res, 400, { error: "Empty question" });
  const id = body.conversationId && conversations.has(body.conversationId) ? body.conversationId : randomUUID();
  const history = conversations.get(id) ?? [];

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("start", { conversationId: id });

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const result = await runAnu(
      desk,
      [...history, { role: "user", content: focusLine(body.focus) + body.question.trim() }],
      { ...(SOURCES[body.sources ?? "papers"] ?? SOURCES.papers), effort: body.effort, index },
      {
        onText: (text) => send("text", { text }),
        onTool: (name, input) => send("tool", { name, input }),
        onEvidence: (items) => send("evidence", { items }),
      },
      abort.signal,
    );
    conversations.set(id, result.history);
    send("done", { stopReason: result.stopReason, refusalCategory: result.refusalCategory ?? null });
  } catch (err) {
    if (!abort.signal.aborted) send("error", { message: describeApiError(err) ?? (err instanceof Error ? err.message : String(err)) });
  }
  res.end();
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

async function serveStatic(pathname: string, res: http.ServerResponse) {
  const rel = path.normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  for (const file of [path.join(STATIC_DIR, rel), path.join(STATIC_DIR, "index.html")]) {
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      return res.end(data);
    } catch {}
  }
  res.writeHead(404).end("Build the app first: npm run app");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/meta") {
      return sendJson(res, 200, {
        overview: overview(desk),
        sectors: [...desk.sectors].sort((a, b) => a.order - b.order),
        companies: desk.companies.map((c) => ({ id: c.id, name: c.name, sectors: c.sectors, type: c.type })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
        modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label })),
        sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label })),
        semantic: !!index,
        brief: getBrief(desk),
        upcoming: upcomingEvents(desk, { days: 60 }),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/sector") return sendJson(res, 200, getSector(desk, url.searchParams.get("id") ?? ""));
    if (req.method === "GET" && url.pathname === "/api/company") {
      const c = companyDetail(url.searchParams.get("id") ?? "");
      return c ? sendJson(res, 200, c) : sendJson(res, 404, { error: "Unknown company" });
    }
    if (req.method === "GET" && url.pathname === "/api/papers") {
      try {
        return sendJson(res, 200, await searchPapers(url.searchParams.get("q") ?? "", { limit: Number(url.searchParams.get("limit") ?? 5) }));
      } catch (err) {
        return sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/ask") return await ask(req, res);
    if (req.method === "POST" && url.pathname === "/api/reset") {
      const { conversationId } = await readBody<{ conversationId?: string }>(req);
      if (conversationId) conversations.delete(conversationId);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET") return await serveStatic(url.pathname, res);
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`ANU is running at http://localhost:${PORT}`));
