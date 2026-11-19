import { XMLParser } from "fast-xml-parser";

// Shared RSS/Atom reading for the free collectors (defense news, housing news, videos).

export const parser = new XMLParser({ ignoreAttributes: false });

export const strip = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#\d+;|&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// WordPress feeds end every item with "The post <title> first appeared on <site>." Drop it.
export const dropFeedFooter = (s: string) => s.replace(/\s*The post .{0,400}? (?:first )?appeared (?:first )?on .{1,120}$/i, "").trim();

export const firstSentences = (s: string, max = 260) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
};

export interface FeedItem { title: string; link: string; date: string; summary: string; raw: Record<string, unknown> }

const textOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"] ?? "");
  return "";
};

/** First real paragraph of the article body. Skips captions, bylines, and newsletter junk. */
function firstParagraph(html: string): string {
  const broken = html
    .replace(/<\/(p|div|h\d|li|blockquote|figcaption)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  for (const part of broken.split(/\n+/)) {
    const text = dropFeedFooter(strip(part));
    if (text.length < 80) continue;
    if (/^(related|also read|more from|subscribe|sign up|advertisement|photo|image|watch:|video:|by [A-Z])/i.test(text)) continue;
    return text;
  }
  return "";
}

/**
 * Prefer the article lede (first paragraph of content:encoded) over the feed's
 * description, which some outlets fill with a pull quote from the middle of the story.
 */
export function summaryFromFields(description: unknown, encoded: unknown): string {
  const lede = firstParagraph(textOf(encoded));
  const blurb = dropFeedFooter(strip(textOf(description)));
  return firstSentences(lede || blurb);
}

export interface FeedReport { items: FeedItem[]; error?: string }

/** Fetches one RSS or Atom feed. On failure logs, returns no items, and keeps the error for feed health. */
export async function fetchFeedReport(name: string, url: string): Promise<FeedReport> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (anu news collector)" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = parser.parse(await res.text());
    const items = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
    const parsed = (Array.isArray(items) ? items : [items]).flatMap((it: Record<string, unknown>) => {
      const links = Array.isArray(it.link) ? it.link : [it.link];
      const alt = links.find((l) => typeof l === "string") ?? links.find((l) => (l as Record<string, string>)?.["@_rel"] === "alternate") ?? links[0];
      const link = typeof alt === "string" ? alt : (alt as Record<string, string>)?.["@_href"] ?? "";
      const raw = (it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]) as string | undefined;
      const when = raw ? new Date(raw) : null;
      const title = strip(typeof it.title === "object" ? (it.title as Record<string, unknown>)?.["#text"] : it.title);
      if (!title || !/^https?:\/\//.test(link) || !when || isNaN(+when)) return [];
      return [{
        title,
        link: link.trim(),
        date: when.toISOString().slice(0, 10),
        summary: summaryFromFields(it.description ?? it.summary, it["content:encoded"] ?? it.content),
        raw: it,
      }];
    });
    return { items: parsed };
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`Skipped ${name}: ${message}`);
    return { items: [], error: message };
  }
}

/** Fetches one RSS or Atom feed; on any failure logs and returns nothing so one bad feed never stops a run. */
export async function fetchFeed(name: string, url: string): Promise<FeedItem[]> {
  return (await fetchFeedReport(name, url)).items;
}
