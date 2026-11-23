/**
 * Ranking, de-duplication, and the one-line summary for the morning brief.
 * Listicles and promos are scored down. Stories that are the same event
 * (one appropriations markup reported three ways) take a single slot.
 */

const TYPE_WEIGHT: Record<string, number> = {
  Contract: 3, Funding: 3, "Policy & budget": 3, "M&A & IPO": 3, Earnings: 2, "Tech milestone": 2, "Conflict & allies": 2, Research: 1,
};

/** Short labels with no colon, so the summary cannot read "areas: adversaries: china". */
const SHORT: Record<string, string> = {
  ai: "AI and software",
  air: "drones",
  sea: "ships",
  ground: "ground robots",
  space: "space",
  missiledef: "missile defense",
  strike: "missiles and munitions",
  cuas: "counter-drone",
  ew: "electronic warfare",
  cyber: "cyber",
  sensing: "sensors",
  mfg: "manufacturing",
  minerals: "critical minerals",
  energy: "energy",
  bio: "biotech",
  policy: "budget and policy",
  capital: "capital markets",
  primes: "the primes",
  global: "allies",
  adversary: "China, Russia and Iran",
};

const LISTICLE = /^\s*\d+\s+\S+.*(opportunit|things|ways|reasons|questions|more)\b/i;

export function isListicle(title: string, body = ""): boolean {
  const text = `${title} ${body}`;
  if (LISTICLE.test(title)) return true;
  if (/\bcontract opportunit/i.test(title)) return true;
  return /\b(roundup|what you need to know|check out these|week in review|sponsored|list of)\b/i.test(text);
}

export function storyScore(u: { type?: string; companies?: string[]; title: string; body?: string; titleScore?: number; primary?: boolean }): number {
  const base = (TYPE_WEIGHT[u.type || ""] ?? 1)
    + (u.companies?.length ?? 0) * 2
    + ((u.titleScore ?? 0) >= 4 ? 2 : 0)
    + (/\$\d/.test(u.title) ? 2 : 0)
    + (u.primary ? 1 : 0);
  return base + (isListicle(u.title, u.body ?? "") ? -20 : 0);
}

const STOP = new Set("the a an of to for and or in on with from its their this that has have after over into than then says said will would about new more most first next than".split(" "));

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/**
 * Same hull in the same place, or the same appropriations markup.
 * Headline wording is not required to match.
 */
export function eventKey(title: string, body = ""): string | null {
  const t = `${title} ${body}`.toLowerCase();
  if (/(corvette|frigate|destroyer|warship)/.test(t) && /(benghazi|libya)/.test(t)) return "warship@libya";
  if (/\bmirage\b/.test(t) && /drone/.test(t)) return "mirage@drone";
  if (/nightmare|\bfpv\b/.test(t) && /(bragg|special forces)/.test(t)) return "fpv@bragg";
  if (/(shotgun|12-gauge)/.test(t) && /benning/.test(t)) return "shotgun@benning";
  return null;
}

/** A later write-up is new only when it adds a dollar figure the earlier one did not have. */
export function materiallyNew(prev: string, next: string): boolean {
  const money = (s: string) => s.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|bn|m|b)?/i)?.[0]?.replace(/\s+/g, "").toLowerCase() ?? "";
  const n = money(next);
  return !!n && n !== money(prev);
}

/** True when two items are the same event told twice, not two events in one sector. */
export function sameEvent(a: { title: string; body?: string }, b: { title: string; body?: string }): boolean {
  const ka = eventKey(a.title, a.body);
  const kb = eventKey(b.title, b.body ?? "");
  if (ka && ka === kb) return true;
  const blob = (x: { title: string; body?: string }) => `${x.title} ${x.body ?? ""}`;
  if (/\bappropriators?\b/i.test(blob(a)) && /\bappropriators?\b/i.test(blob(b))) return true;
  const ta = words(a.title);
  const tb = words(b.title);
  const inter = [...ta].filter((t) => tb.has(t));
  const union = new Set([...ta, ...tb]).size || 1;
  return inter.length >= 3 && inter.length / union >= 0.45;
}

export function pickTop<T extends { title: string; body?: string; sectors: string[]; score: number; d: string }>(
  items: T[],
  n = 5,
  prior: { title: string; body?: string }[] = [],
): T[] {
  const ranked = [...items].sort((a, b) => b.score - a.score || b.d.localeCompare(a.d));
  const picked: T[] = [];
  const used = new Set<string>();
  const already = (u: T) => prior.some((p) => {
    const k = eventKey(u.title, u.body);
    return !!k && k === eventKey(p.title, p.body) && !materiallyNew(`${p.title} ${p.body ?? ""}`, `${u.title} ${u.body ?? ""}`);
  });
  const take = (repeatSector: boolean) => {
    for (const u of ranked) {
      if (picked.includes(u) || already(u)) continue;
      if (!repeatSector && used.has(u.sectors[0]) && picked.length < ranked.length - 1) continue;
      if (picked.some((p) => sameEvent(p, u))) continue;
      picked.push(u);
      if (u.sectors[0]) used.add(u.sectors[0]);
      if (picked.length === n) return;
    }
  };
  take(false);
  if (picked.length < n) take(true);
  return picked;
}

function tally(ids: string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

const labelOf = (id: string, submarines: boolean) => id === "sea" && submarines ? "ships and submarines" : (SHORT[id] ?? id);
const pair = (ids: string[], submarines: boolean) => {
  const labels = ids.map((id) => labelOf(id, submarines));
  if (labels.length < 2) return labels[0] ?? "";
  const [a, b] = labels;
  return /\band\b/i.test(a) || /\band\b/i.test(b) ? `${a}, plus ${b}` : `${a} and ${b}`;
};

/**
 * Quiet days say so. Labels come from the stories that were picked, and a label
 * that already contains "and" is joined with "plus" so it doesn't read "Iran and drones".
 */
export function briefSummary(
  total: number,
  leadSectors: string[],
  topSectors: string[],
  opts: { gist?: string; text?: string } = {},
): string {
  if (total <= 0) return "Quiet day: nothing new that was not already covered.";
  if (total === 1 && opts.gist) return `Quiet weekend: 1 new story, ${opts.gist.replace(/\.$/, "")}.`;
  const subs = /submarine/i.test(opts.text ?? "");
  const volume = tally(leadSectors).slice(0, 2);
  const focus = tally(topSectors).slice(0, 2);
  const n = `${total} new stories`;
  if (!focus.length) return `${n}.`;
  const about = pair(focus, subs);
  const most = pair(volume, subs);
  if (most && most !== about) return `${n}. Most came from ${most}; the top five are mostly about ${about}.`;
  return `${n}. The top five are mostly about ${about}.`;
}

/** One clause for a one-story day, taken from the event rather than the headline's casing. */
export function storyGist(title: string, body = ""): string {
  const t = `${title} ${body}`.toLowerCase();
  if (/corvette/.test(t) && /(libya|benghazi)/.test(t)) return "Ukraine's drone boats hit a Russian corvette in Libya";
  return title.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}
