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
  flag?: string;
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
    const newest = runs[0]?.newest;
    const stale = !!newest && daysBefore(today, newest) > 2;
    let flag = flagFor(runs, today);
    if (stale) flag = flag ? `${flag}; stale: newest item ${newest} is more than 2 days old` : `stale: newest item ${newest} is more than 2 days old`;
    feeds[o.name] = { url: o.url, runs, ...(stale ? { stale } : {}), ...(flag ? { flag } : {}) };
  }
  return { updatedAt, feeds };
}

export function flaggedFeeds(health: FeedHealth): { name: string; flag: string }[] {
  return Object.entries(health.feeds)
    .filter(([, s]) => s.flag)
    .map(([name, s]) => ({ name, flag: s.flag! }));
}
