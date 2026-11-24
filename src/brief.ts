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

/** Ceremonies, promo, and show episodes are not brief stories. */
export function isFiller(title: string, body = ""): boolean {
  const text = `${title} ${body}`;
  if (/\b(oath of enlistment|demo team returns|full episode|week in review)\b/i.test(text)) return true;
  if (/\bMOAA\b/.test(title) || /\bheadlines$/i.test(title.trim())) return true;
  if (/\bveterans bills\b/i.test(title)) return true;
  return false;
}

/** Commercial space (memorial flights, cremated remains) is not a defense lead. */
export function isConsumerSpace(title: string, body = ""): boolean {
  const text = `${title} ${body}`;
  if (/space force|missile|military satellite|\bSDA\b/i.test(text)) return false;
  return /cremated|memorial spacecraft|memorial cubesat|ashes\b|space burial|space tourism/i.test(text);
}

export function storyScore(u: { type?: string; companies?: string[]; title: string; body?: string; titleScore?: number; primary?: boolean }): number {
  const text = `${u.title} ${u.body ?? ""}`;
  let base = (TYPE_WEIGHT[u.type || ""] ?? 1)
    + (u.companies?.length ?? 0) * 2
    + ((u.titleScore ?? 0) >= 4 ? 2 : 0)
    + (/\$\d/.test(u.title) ? 2 : 0)
    + (u.primary ? 1 : 0);
  if (isListicle(u.title, u.body ?? "")) base -= 20;
  if (isFiller(u.title, u.body ?? "")) base -= 40;
  if (isConsumerSpace(u.title, u.body ?? "")) base -= 30;
  if (/\bnasa\b/i.test(text) && /noaa|weather service|sounder/i.test(text) && !/space force|missile|pentagon|department of war/i.test(text)) base -= 18;
  if (/\bspac\b|nyse debut/i.test(text)) base -= 12;
  if (/(private equity|to acquire)/i.test(text) && /satellite/i.test(text) && !/military|missile|space force|department of war/i.test(text)) base -= 10;
  if (/(sank|sinks|sunk|shot down|destroyed)/i.test(text) && /(corvette|warship|missile|drone|carrier|interceptor)/i.test(text)) base += 14;
  if (/nuclear/i.test(text) && /carrier/i.test(text)) base += 10;
  if (/\$\d/.test(text) && /(contract|loan|award|sole-source|modification|backlog)/i.test(text)) base += 4;
  return base;
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
/** Strip show-episode furniture so two airings of the same segment compare equal. */
export function coreTitle(title: string): string {
  return title.replace(/\b(defense news weekly|full episode|moaa headlines|headlines)\b.*$/i, "").replace(/\s+/g, " ").trim();
}

export function eventKey(title: string, body = ""): string | null {
  const t = `${title} ${body}`.toLowerCase();
  const naval = /(corvette|frigate|destroyer|warship|cargo vessel|naval drone|sea drone|mothership|convoy)/.test(t);
  const libya = /(benghazi|libya|tunis)/.test(t);
  if (naval && libya) return "warship@libya";
  if (libya && /(sank|sunk|struck|strike)/.test(t) && /(ship|vessel|corvette|naval|convoy|drone)/.test(t)) return "warship@libya";
  if (/\bcerberus\b/.test(t) && /\bairbus\b/.test(t)) return "cerberus@airbus";
  if (/\bmirage\b/.test(t) && /drone/.test(t)) return "mirage@drone";
  if (/nightmare|\bfpv\b/.test(t) && /(bragg|special forces)/.test(t)) return "fpv@bragg";
  if (/(shotgun|12-gauge)/.test(t) && /benning/.test(t)) return "shotgun@benning";
  const episode = coreTitle(title).toLowerCase();
  if (episode && episode.length > 12 && /gun down drones/.test(episode)) return `episode:${episode}`;
  return null;
}

/** A later write-up is new only when it adds a dollar figure the earlier one did not have. */
export function materiallyNew(prev: string, next: string): boolean {
  const money = (s: string) => s.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|bn|m|b)?/i)?.[0]?.replace(/\s+/g, "").toLowerCase() ?? "";
  const n = money(next);
  return !!n && n !== money(prev);
}

function titleAlike(a: string, b: string): boolean {
  const ta = words(coreTitle(a));
  const tb = words(coreTitle(b));
  const inter = [...ta].filter((t) => tb.has(t));
  const union = new Set([...ta, ...tb]).size || 1;
  return inter.length >= 3 && inter.length / union >= 0.45;
}

/**
 * Same event across feeds, by a shared event key or by the headline itself.
 * Appropriations bills are not collapsed here; `sameEvent` does that inside one day.
 */
export function sameStory(a: { title: string; body?: string }, b: { title: string; body?: string }): boolean {
  const ka = eventKey(a.title, a.body);
  const kb = eventKey(b.title, b.body ?? "");
  if (ka && ka === kb) return true;
  return titleAlike(a.title, b.title);
}

/** True when two items are the same event told twice, not two events in one sector. */
export function sameEvent(a: { title: string; body?: string }, b: { title: string; body?: string }): boolean {
  if (sameStory(a, b)) return true;
  const blob = (x: { title: string; body?: string }) => `${x.title} ${x.body ?? ""}`;
  if (/\bappropriators?\b/i.test(blob(a)) && /\bappropriators?\b/i.test(blob(b))) return true;
  return false;
}

export interface DedupeDrop<T> { item: T; because: string }

/** Keep the highest-scored write-up of each event. Recent days count as already told. */
export function dedupeEvents<T extends { title: string; body?: string; score: number }>(
  items: T[],
  prior: { title: string; body?: string; d?: string }[] = [],
): { kept: T[]; dropped: DedupeDrop<T>[] } {
  const ranked = [...items].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const dropped: DedupeDrop<T>[] = [];
  for (const item of ranked) {
    const earlier = prior.find((p) => sameStory(p, item) && !materiallyNew(`${p.title} ${p.body ?? ""}`, `${item.title} ${item.body ?? ""}`));
    if (earlier) {
      dropped.push({ item, because: earlier.d ? `already covered on ${earlier.d}` : "already covered" });
      continue;
    }
    const twin = kept.find((p) => sameStory(p, item));
    if (twin) {
      dropped.push({ item, because: `same event as “${twin.title}”` });
      continue;
    }
    kept.push(item);
  }
  return { kept, dropped };
}

export function pickTop<T extends { title: string; body?: string; sectors: string[]; score: number; d: string }>(
  items: T[],
  n = 5,
  prior: { title: string; body?: string }[] = [],
): T[] {
  const ranked = [...items].sort((a, b) => b.score - a.score || b.d.localeCompare(a.d));
  const picked: T[] = [];
  const used = new Set<string>();
  const already = (u: T) => prior.some((p) => sameStory(p, u) && !materiallyNew(`${p.title} ${p.body ?? ""}`, `${u.title} ${u.body ?? ""}`));
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

function tally(ids: string[]): { id: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, n]) => ({ id, n }));
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
  const volume = tally(leadSectors);
  const focus = tally(topSectors);
  const n = `${total} new ${total === 1 ? "story" : "stories"}`;
  if (!focus.length) return `${n}.`;
  const focusIds = (focus[0]?.n ?? 0) >= 2 ? focus.slice(0, 2).map((row) => row.id) : [];
  const about = focusIds.length ? pair(focusIds, subs) : focus.map((row) => labelOf(row.id, subs)).join(", ");
  const mostly = focus[0] && focus[0].n >= 2 && focus[0].n > (focus[1]?.n ?? 0) ? "mostly " : "";
  const volTop = volume[0];
  const volShare = volTop && leadSectors.length ? volTop.n / leadSectors.length : 0;
  let from = "";
  if (volTop && volTop.n >= 2 && volShare >= 0.5) {
    const ids = volume.slice(0, 2).map((row) => row.id);
    from = `Most came from ${pair(ids, subs)}`;
  } else if (volTop && volTop.n >= 2) {
    from = `The new stories are led by ${labelOf(volTop.id, subs)}`;
  }
  const top = `the top five are ${mostly}about ${about}`;
  if (from) return `${n}. ${from}; ${top}.`;
  return `${n}. ${top.charAt(0).toUpperCase()}${top.slice(1)}.`;
}

/** One sentence on the last two weeks, dated by the collect run, so the October picture is not the only pulse. */
export function weekLine(updates: { d: string; sectors?: string[]; title: string }[], today: string): string {
  const start = new Date(Date.parse(today) - 14 * 864e5).toISOString().slice(0, 10);
  const recent = updates.filter((u) => u.d >= start && u.d <= today);
  if (!recent.length) return `No stories filed between ${start} and ${today}.`;
  const leaders = tally(recent.map((u) => u.sectors?.[0] || "").filter(Boolean)).slice(0, 3);
  const led = leaders.map((row) => `${labelOf(row.id, false)} (${row.n})`).join(", ");
  return `${recent.length} stories since ${start}, led by ${led}.`;
}

/** One clause for a one-story day, taken from the event rather than the headline's casing. */
export function storyGist(title: string, body = ""): string {
  const t = `${title} ${body}`.toLowerCase();
  if (/corvette/.test(t) && /(libya|benghazi)/.test(t)) return "Ukraine's drone boats hit a Russian corvette in Libya";
  return title.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}
