/**
 * Per-feed item counts across runs. A feed is flagged when it has been empty,
 * stale, or only a duplicate of another feed for several days in a row.
 */
export interface FeedRun {
  date: string;
  fetched: number;
  inWindow: number;
  added: number;
  duplicates: number;
  newest?: string;
  error?: string;
}

export interface FeedStat {
  url: string;
  runs: FeedRun[];
  /** Newest item is more than two days behind the run date. */
  stale?: boolean;
  /** Latest run fetched nothing or returned an error. */
  down?: boolean;
  flag?: string;
}

export interface FeedBadge {
  name: string;
  kind: "down" | "stale";
  label: string;
}

export interface FeedHealth {
  updatedAt: string;
  feeds: Record<string, FeedStat>;
}

export interface FeedObservation {
  name: string;
  url: string;
  fetched: number;
  inWindow: number;
  added: number;
  duplicates: number;
  newest?: string;
  error?: string;
}

const KEEP = 14;
const DEAD_RUNS = 4;
const STALE_RUNS = 4;
const SHADOW_RUNS = 5;
const STALE_DAYS = 21;

const daysBefore = (today: string, date: string) => (Date.parse(today) - Date.parse(date)) / 864e5;

function streak(runs: FeedRun[], pred: (r: FeedRun) => boolean): number {
  let n = 0;
  for (const r of runs) {
    if (!pred(r)) break;
    n++;
  }
  return n;
}

function flagFor(runs: FeedRun[], today: string): string | undefined {
  const dead = streak(runs, (r) => r.fetched === 0);
  if (dead >= DEAD_RUNS) {
    const why = runs[0]?.error ? ` (${runs[0].error})` : "";
    return `0 items for ${dead} straight runs${why}`;
  }
  const stale = streak(runs, (r) => r.fetched > 0 && r.inWindow === 0 && (!r.newest || daysBefore(today, r.newest) > STALE_DAYS));
  if (stale >= STALE_RUNS) {
    const newest = runs[0]?.newest ? `, newest item ${runs[0].newest}` : "";
    return `no recent items for ${stale} straight runs${newest}`;
  }
  const shadow = streak(runs, (r) => r.inWindow > 0 && r.added === 0 && r.duplicates > 0 && r.duplicates * 2 >= r.inWindow);
  if (shadow >= SHADOW_RUNS) return `every in-window item duplicated another feed for ${shadow} straight runs`;
  const filtered = streak(runs, (r) => r.fetched > 0 && r.inWindow >= 3 && r.added === 0 && r.duplicates * 2 < r.inWindow);
  if (filtered >= 3) return `fresh items were dropped by the filter for ${filtered} straight runs`;
  return undefined;
}

/**
 * Newest item date stuck in the past across several runs, even if a later run recovered.
 * "2026-11-20–2026-11-23: newest item stuck at 2026-11-19".
 */
export function stuckLabel(runs: FeedRun[]): string | undefined {
  const chrono = [...runs].reverse();
  let best: { newest: string; dates: string[] } | null = null;
  let cur: { newest: string; dates: string[] } | null = null;
  for (const run of chrono) {
    if (!run.newest || run.newest >= run.date) {
      cur = null;
      continue;
    }
    if (cur && cur.newest === run.newest) cur.dates.push(run.date);
    else cur = { newest: run.newest, dates: [run.date] };
    if (!best || cur.dates.length > best.dates.length) best = { newest: cur.newest, dates: [...cur.dates] };
  }
  if (!best || best.dates.length < 3) return;
  const last = best.dates[best.dates.length - 1];
  // A one-day publishing lag is normal. SpaceNews sat four days behind.
  if (daysBefore(last, best.newest) <= 3) return;
  return `stale ${best.dates[0]}–${best.dates[best.dates.length - 1]}: newest item stuck at ${best.newest}`;
}

function decorate(runs: FeedRun[], today: string): Pick<FeedStat, "stale" | "down" | "flag"> {
  const newest = runs[0]?.newest;
  const stale = !!newest && daysBefore(today, newest) > 2;
  const down = !!runs[0] && (runs[0].fetched === 0 || !!runs[0].error);
  let flag = flagFor(runs, today);
  if (stale) flag = flag ? `${flag}; stale: newest item ${newest} is more than 2 days old` : `stale: newest item ${newest} is more than 2 days old`;
  const stuck = stuckLabel(runs);
  if (stuck && !stale) flag = flag ? `${flag}; ${stuck}` : stuck;
  return { ...(stale ? { stale } : {}), ...(down ? { down } : {}), ...(flag ? { flag } : {}) };
}

/** Fold this run's counts into the history. Feeds no longer collected are dropped. */
export function updateFeedHealth(prev: FeedHealth | null, obs: FeedObservation[], today: string, updatedAt: string): FeedHealth {
  const feeds: Record<string, FeedStat> = {};
  for (const o of obs) {
    const prior = prev?.feeds[o.name]?.runs ?? [];
    const run: FeedRun = {
      date: today,
      fetched: o.fetched,
      inWindow: o.inWindow,
      added: o.added,
      duplicates: o.duplicates,
      ...(o.newest ? { newest: o.newest } : {}),
      ...(o.error ? { error: o.error } : {}),
    };
    const runs = [run, ...prior.filter((r) => r.date !== today)].slice(0, KEEP);
    feeds[o.name] = { url: o.url, runs, ...decorate(runs, today) };
  }
  return { updatedAt, feeds };
}

/** Recompute stale, down, and flag from runs already stored, without adding a run. */
export function refreshFeedHealth(health: FeedHealth, today: string): FeedHealth {
  const feeds: Record<string, FeedStat> = {};
  for (const [name, stat] of Object.entries(health.feeds)) {
    feeds[name] = { url: stat.url, runs: stat.runs, ...decorate(stat.runs, today) };
  }
  return { updatedAt: health.updatedAt, feeds };
}

/** Badges for the brief: a feed that failed today, or one whose newest item was stuck. */
export function feedBadges(health: FeedHealth): FeedBadge[] {
  const out: FeedBadge[] = [];
  for (const [name, stat] of Object.entries(health.feeds)) {
    if (stat.down) {
      const why = stat.runs[0]?.error ? `: ${stat.runs[0].error}` : "";
      out.push({ name, kind: "down", label: `feed down${why}` });
    } else if (stat.stale || (stat.flag && /stale|stuck/i.test(stat.flag))) {
      out.push({ name, kind: "stale", label: stat.flag || "stale" });
    }
  }
  return out;
}

export function flaggedFeeds(health: FeedHealth): { name: string; flag: string }[] {
  return Object.entries(health.feeds)
    .filter(([, s]) => s.flag)
    .map(([name, s]) => ({ name, flag: s.flag! }));
}
