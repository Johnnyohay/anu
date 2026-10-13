import readline from "node:readline/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { loadDesk } from "./store.ts";
import { describeApiError, runJarvis, type RunHandlers } from "./jarvis.ts";

// Jarvis on the command line. For the app with dropdowns and panels, use `npm run app`.
//   npm run ask -- "What should I learn first about counter-drone?"
//   npm run ask                      (conversation; type "exit" to quit)
//   npm run ask -- --web "…"         (also lets Jarvis search the web for news newer than the data)
// Uses the paid Claude API (ANTHROPIC_API_KEY or an `ant auth login` profile).

const desk = await loadDesk();
const args = process.argv.slice(2);
const web = args.includes("--web");
const question = args.filter((a) => a !== "--web").join(" ").trim();

const handlers: RunHandlers = {
  onText: (t) => process.stdout.write(t),
  onTool: (name, input) => process.stderr.write(`\n  · ${name} ${JSON.stringify(input)}\n`),
};

async function turn(messages: Anthropic.Beta.BetaMessageParam[]) {
  const res = await runJarvis(desk, messages, { web }, handlers);
  process.stdout.write("\n");
  if (res.stopReason === "refusal") console.error(`\n[Declined: ${res.refusalCategory ?? "no category"}]`);
  else if (res.stopReason === "max_tokens") console.error("\n[Answer was cut off at the length limit.]");
  return res.history;
}

try {
  if (question) {
    await turn([{ role: "user", content: question }]);
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`Jarvis here. ${desk.updates.length} updates, ${desk.companies.length} companies, ${desk.sectors.length} sectors loaded${web ? ", web search on" : ""}. Ask anything; "exit" to quit.`);
    let history: Anthropic.Beta.BetaMessageParam[] = [];
    for (;;) {
      const q = (await rl.question("\nyou › ")).trim();
      if (!q) continue;
      if (/^(exit|quit)$/i.test(q)) break;
      process.stdout.write("\njarvis › ");
      history = await turn([...history, { role: "user", content: q }]);
    }
    rl.close();
  }
} catch (err) {
  const msg = describeApiError(err);
  if (!msg) throw err;
  console.error(msg);
  process.exit(1);
}
