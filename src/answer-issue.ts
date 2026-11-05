import { writeFile } from "node:fs/promises";
import { z } from "zod/v4";
import { loadDesk } from "./store.ts";
import { toolSpecs } from "./tools.ts";
import { focusLine, MODES, systemPrompt, type Focus, type Mode } from "./prompts.ts";
import { runToolLoop, type LoopTool } from "./loop.ts";
import { PROVIDERS, type ChatMsg } from "./llm.ts";
import { grokPrompt, verifyAnswer } from "./verify.ts";

// Answers a question asked as a GitHub issue ("Ask ANU: …"), run by .github/workflows/ask.yml.
// Everything happens on GitHub for free: the data is this repo's data/, the models are
// Groq's free tier (GROQ_API_KEY secret) or, without a key, a small model the workflow runs
// inside the job with Ollama. The answer is posted back as a comment. Follow-up comments
// on the issue continue the conversation. (GitHub Models, used before, was retired in 2026.)
//
// Env: ISSUE_TITLE, ISSUE_BODY, THREAD (JSON [{author, body}] of earlier comments), GROQ_API_KEY or OLLAMA_MODEL.

const BOT_MARK = "<!-- anu-answer -->";

/** Focus settings the site's Ask form writes into the issue body as "Key: value" lines. */
function parseFocus(body: string): Focus {
  const get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "mi").exec(body)?.[1]?.trim();
  const modeLabel = get("Mode");
  const mode = Object.entries(MODES).find(([id, m]) => id === modeLabel || m.label === modeLabel)?.[0] as Mode | undefined;
  const days = Number(get("Days"));
  return { mode, sector: get("Sector id"), company: get("Company id"), days: Number.isFinite(days) && days > 0 ? days : undefined };
}

const desk = await loadDesk();
const title = (process.env.ISSUE_TITLE ?? "").replace(/^\s*Ask ANU:\s*/i, "").trim();
const body = process.env.ISSUE_BODY ?? "";
const thread = JSON.parse(process.env.THREAD || "[]") as { author: string; body: string }[];
const question = (body.split(/^---$/m)[0].trim() || title).trim();
const focus = parseFocus(body);

// Earlier exchanges on this issue become the conversation history.
const history: ChatMsg[] = [];
let latest = focusLine(desk, focus) + question;
for (const c of thread) {
  if (c.body.includes(BOT_MARK)) {
    history.push({ role: "user", content: latest }, { role: "assistant", content: c.body.split("<details>")[0].replace(BOT_MARK, "").trim() });
  } else latest = c.body.trim();
}
const isFollowUp = thread.length > 0 && !thread.at(-1)!.body.includes(BOT_MARK);
const ask = isFollowUp ? latest : focusLine(desk, focus) + question;

// The fact-check uses a different model from the answer, so it is a real second opinion.
const groq = !!process.env.GROQ_API_KEY;
const answerModel = groq ? PROVIDERS.groq("openai/gpt-oss-120b") : PROVIDERS.ollama();
const checkModel = groq ? PROVIDERS.groq("llama-3.3-70b-versatile") : PROVIDERS.ollama();

const evidence: { tool: string; output: string }[] = [];
const sources: string[] = [];
const tools: LoopTool[] = toolSpecs(desk, { papers: true }, (items) =>
  items.forEach((e) => {
    const url = /https?:\/\/\S+/.exec(e.source ?? "")?.[0];
    const line = `- ${e.date} — ${url ? `[${e.title}](${url})` : e.title}${e.source ? ` (${e.source.replace(/\s*https?:\/\/\S+/, "")})` : ""}`;
    if (!sources.includes(line)) sources.push(line);
  }),
).map((t) => ({
  name: t.name,
  description: t.description,
  parameters: z.toJSONSchema(t.inputSchema),
  parse: (x) => t.inputSchema.parse(x),
  run: async (x) => {
    const out = await t.run(x);
    evidence.push({ tool: t.name, output: out });
    return out;
  },
}));

let answer = "";
let out: string;
try {
  const res = await runToolLoop({ provider: answerModel, system: systemPrompt(desk, { papers: true }), messages: [...history, { role: "user", content: ask }], tools, maxSteps: 8, resultChars: 6000 }, { onText: (t) => (answer += t) });
  answer = answer.trim() || "I couldn't put together an answer this time. Try rephrasing the question.";
  if (res.stopReason === "max_steps") answer += "\n\n_(Stopped after the maximum number of lookups.)_";

  let checkMd = "";
  try {
    const check = await verifyAnswer({ question: isFollowUp ? latest : question, answer, evidence }, { provider: checkModel });
    const icon = { supported: "✅", not_in_evidence: "⚠️", contradicted: "❌" } as const;
    checkMd = `**Fact-check: ${check.confidence}/100** by ${check.checker}. ${check.summary}\n\n${check.claims.map((c) => `- ${icon[c.verdict]} ${c.claim}${c.note ? ` — _${c.note}_` : ""}`).join("\n")}`;
  } catch (err) {
    checkMd = `_Fact-check unavailable: ${err instanceof Error ? err.message : String(err)}_`;
  }

  out = `${BOT_MARK}
${answer}

<details><summary>Second-opinion fact-check</summary>

${checkMd}
</details>

<details><summary>Sources ANU looked at (${sources.length})</summary>

${sources.join("\n") || "_No stored sources were used._"}
</details>

<details><summary>Check with Grok (free): copy this into grok.com</summary>

\`\`\`text
${grokPrompt({ question: isFollowUp ? latest : question, answer, evidence }).replace(/```/g, "'''")}
\`\`\`
</details>

<sub>Answered by ${answerModel.label} from ANU's data (updates to ${desk.updates.map((u) => u.d).sort().at(-1)}). Reply on this issue to ask a follow-up.</sub>`;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  out = `${BOT_MARK}\nANU couldn't answer right now: ${/429/.test(msg) ? "the free Groq limit is used up for now. Ask again in a while." : msg}`;
}
await writeFile("answer.md", out);
console.log(out.slice(0, 2000));
