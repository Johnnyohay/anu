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
  sea: "ships and submarines",
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

/** True when two items are the same event told twice, not two events in one sector. */
export function sameEvent(a: { title: string; body?: string }, b: { title: string; body?: string }): boolean {
  const blob = (x: { title: string; body?: string }) => `${x.title} ${x.body ?? ""}`;
  if (/\bappropriators?\b/i.test(blob(a)) && /\bappropriators?\b/i.test(blob(b))) return true;
  const ta = words(a.title);
  const tb = words(b.title);
  const inter = [...ta].filter((t) => tb.has(t));
  const union = new Set([...ta, ...tb]).size || 1;
  return inter.length >= 3 && inter.length / union >= 0.45;
}

export function pickTop<T extends { title: string; body?: string; sectors: string[]; score: number; d: string }>(items: T[], n = 5): T[] {
  const ranked = [...items].sort((a, b) => b.score - a.score || b.d.localeCompare(a.d));
  const picked: T[] = [];
  const used = new Set<string>();
  const take = (repeatSector: boolean) => {
    for (const u of ranked) {
      if (picked.includes(u)) continue;
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

const label = (id: string) => SHORT[id] ?? id;
const pair = (ids: string[]) => ids.length >= 2 ? `${label(ids[0])} and ${label(ids[1])}` : label(ids[0] ?? "");

/**
 * "13 new stories. Most came from X and Y; the top five are mostly about Z."
 * X and Y are the lead sectors of the whole day's intake. Z is the lead sectors of the stories actually picked.
 */
export function briefSummary(total: number, leadSectors: string[], topSectors: string[]): string {
  const volume = tally(leadSectors).slice(0, 2);
  const focus = tally(topSectors).slice(0, 2);
  const n = `${total} new ${total === 1 ? "story" : "stories"}`;
  if (!focus.length) return `${n}.`;
  const about = pair(focus);
  const most = pair(volume);
  if (most && most !== about) return `${n}. Most came from ${most}; the top five are mostly about ${about}.`;
  return `${n}. The top five are mostly about ${about}.`;
}
