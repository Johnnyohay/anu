import { loadDesk } from "./store.ts";
import { findCompanies, getBrief, getSector, listIdeas, overview, searchResearch, searchUpdates, upcomingEvents } from "./kb.ts";

// Free, offline lookups over data/ — no API key. Prints JSON.
//   npm run kb -- overview
//   npm run kb -- updates "counter-drone contract" --sector cuas --since 2026-10-01
//   npm run kb -- sector space
//   npm run kb -- companies anduril
//   npm run kb -- events --sector policy --days 60
//   npm run kb -- research autonomy
//   npm run kb -- ideas --sector air
//   npm run kb -- brief [YYYY-MM-DD]

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i] ?? "";
  else positional.push(rest[i]);
}
const query = positional.join(" ") || undefined;
const num = (k: string) => (flags[k] ? Number(flags[k]) : undefined);

const desk = await loadDesk();
const commands: Record<string, () => unknown> = {
  overview: () => overview(desk),
  updates: () =>
    searchUpdates(desk, {
      query,
      sectors: flags.sector ? flags.sector.split(",") : undefined,
      type: flags.type,
      company: flags.company,
      since: flags.since,
      until: flags.until,
      limit: num("limit"),
    }),
  sector: () => getSector(desk, query ?? ""),
  companies: () => findCompanies(desk, { query, sector: flags.sector, limit: num("limit") }),
  events: () => upcomingEvents(desk, { sector: flags.sector, days: num("days") }),
  research: () => searchResearch(desk, { query, sector: flags.sector, limit: num("limit") }),
  ideas: () => listIdeas(desk, { sector: flags.sector }),
  brief: () => getBrief(desk, query),
};

const run = commands[cmd ?? ""];
if (!run) {
  console.error(`Usage: npm run kb -- <${Object.keys(commands).join("|")}> [query] [--sector id] [--type T] [--company name] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--days N] [--limit N]`);
  process.exit(1);
}
console.log(JSON.stringify(run(), null, 2));
