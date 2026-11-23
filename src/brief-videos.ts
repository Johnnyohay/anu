/**
 * Videos for today's brief. A clip has to share a named program, system, or place
 * with a story. Generic defense words (military, weapons, defense) do not count.
 */

export interface Clip {
  id?: string;
  title: string;
  desc?: string;
  topic?: string;
  channel?: string;
}

export interface StoryRef { title: string; body?: string; sector?: string }

export interface VideoPick {
  video: Clip;
  score: number;
  because: string[];
}

export interface VideoReject {
  video: Clip;
  reason: string;
}

const ENTITIES = ["mirage", "benghazi", "libya", "nightmare", "bragg", "benning", "corvette", "sewip", "thaad", "stinger", "pyka", "crimea", "kaliningrad", "fpv", "usv", "shotgun", "himars", "valkyrie", "dropship", "black sea"];

function specificTokens(text: string): string[] {
  const raw = text.toLowerCase();
  return ENTITIES.filter((k) => raw.includes(k));
}

/**
 * Keep a video only when it shares specific names with today's stories.
 * Score is the count of those shared names. Below `minScore` (default 2, or 1
 * when the shared name is a rare proper token of 6+ letters) the video is rejected.
 */
export function selectBriefVideos(
  stories: StoryRef[],
  videos: Clip[],
  opts: { limit?: number; minScore?: number } = {},
): { kept: VideoPick[]; rejected: VideoReject[] } {
  const min = opts.minScore ?? 2;
  const weight = new Map<string, number>();
  for (const s of stories) {
    for (const tok of specificTokens(`${s.title} ${s.body ?? ""}`)) {
      weight.set(tok, (weight.get(tok) ?? 0) + (tok.length >= 6 ? 2 : 1));
    }
  }
  const kept: VideoPick[] = [];
  const rejected: VideoReject[] = [];
  for (const video of videos) {
    if (video.topic && video.topic !== "defense") {
      rejected.push({ video, reason: "not a defense clip" });
      continue;
    }
    const toks = specificTokens(`${video.title} ${video.desc ?? ""}`);
    const countries = new Set("ukraine ukrainian russia russian china chinese canada libya libyan iran nato america american".split(" "));
    const hit = toks.filter((t) => weight.has(t));
    const specific = hit.filter((t) => !countries.has(t));
    const score = specific.reduce((n, t) => n + (weight.get(t) ?? 0), 0);
    const rare = specific.some((t) => t.length >= 5);
    if (specific.length && (score >= min || rare)) {
      kept.push({ video, score, because: hit });
    } else {
      rejected.push({
        video,
        reason: specific.length ? `only a weak overlap (${specific.join(", ")})` : "no shared program, system, or place with today's stories",
      });
    }
  }
  kept.sort((a, b) => b.score - a.score || a.video.title.localeCompare(b.video.title));
  return { kept: kept.slice(0, opts.limit ?? 4), rejected };
}
