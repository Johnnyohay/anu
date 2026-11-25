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

/** Photo captions and unit roll calls are not the news. */
export function isCaption(text: string): boolean {
  if (/\b(assigned to|pictured|shown here)\b/i.test(text) && /\b(participate|training|exercise|during|ceremony)\b/i.test(text)) return true;
  if (/^(left to right|courtesy of|photo\b|image\b)/i.test(text.trim())) return true;
  return false;
}

/** A paragraph that is only someone speaking, with no news verb of its own. */
export function isRawQuote(text: string): boolean {
  const t = text.trim();
  if (/^[“"']/.test(t)) return true;
  if (/\b(said|says|told)\b/i.test(t) && /^(if|we|i|you|this|that|there|when)\b/i.test(t)) return true;
  return false;
}

function substantive(text: string): boolean {
  if (text.length < 80) return false;
  if (isCaption(text) || isRawQuote(text)) return false;
  if (/^(related|also read|more from|subscribe|sign up|advertisement|photo|image|watch:|video:|by [A-Z]|table of contents|logo:)/i.test(text)) return false;
  if (/\b(hear about|register now|webinar)\b/i.test(text)) return false;
  return true;
}

/** First real paragraph of the article body. Skips captions, pull quotes, bylines, and newsletter junk. */
function firstParagraph(html: string): string {
  const broken = html
    .replace(/<\/(p|div|h\d|li|blockquote|figcaption)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  for (const part of broken.split(/\n+/)) {
    const text = dropFeedFooter(strip(part));
    if (!substantive(text)) continue;
    return text;
  }
  return "";
}

/**
 * Prefer the article lede (first substantive paragraph of content:encoded) over the
 * feed's description, which some outlets fill with a pull quote or a photo caption.
 */
export function summaryFromFields(description: unknown, encoded: unknown): string {
  const lede = firstParagraph(textOf(encoded));
  const blurb = dropFeedFooter(strip(textOf(description)));
  const blurbOk = blurb.length >= 40 && !isCaption(blurb) && !isRawQuote(blurb);
  return firstSentences(lede || (blurbOk ? blurb : ""));
}

export interface FeedReport { items: FeedItem[]; error?: string }

/** Browser headers. A short custom UA is what gets a 403 from Cloudflare-fronted feeds. */
export const FEED_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

/**
 * Other addresses to try after the primary feed fails. A WordPress `/feed/`
 * that returns 403 often still serves the same posts as JSON.
 */
export function fallbackFeedUrls(url: string, alts: string[] = []): string[] {
  const out = [...alts];
  try {
    const u = new URL(url);
    if (/\/feed\/?$/i.test(u.pathname)) {
      out.push(`${u.origin}/wp-json/wp/v2/posts?per_page=15&_fields=date,link,title,excerpt`);
    }
  } catch { /* not a URL */ }
  return [...new Set(out.filter((candidate) => candidate && candidate !== url))];
}

async function readFeed(name: string, url: string): Promise<FeedReport> {
  if (url.includes("/wp-json/")) return fetchWpPosts(name, url);
  try {
    const res = await fetch(url, { headers: FEED_HEADERS, signal: AbortSignal.timeout(20000) });
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

/**
 * Fetches one RSS or Atom feed. On a 403 or an empty body, tries alternate
 * URLs (and the WordPress JSON sibling of a `/feed/` address) before giving up.
 */
export async function fetchFeedReport(name: string, url: string, alts: string[] = []): Promise<FeedReport> {
  const plan = [url, ...fallbackFeedUrls(url, alts)];
  let primaryError = "";
  for (let i = 0; i < plan.length; i++) {
    const report = await readFeed(name, plan[i]);
    if (!report.error && report.items.length) return report;
    if (i === 0) primaryError = report.error || "no items";
    else if (report.error) console.warn(`Fallback ${name} ${plan[i]}: ${report.error}`);
  }
  return { items: [], error: primaryError || "no items" };
}

/** Fetches one RSS or Atom feed; on any failure logs and returns nothing so one bad feed never stops a run. */
export async function fetchFeed(name: string, url: string, alts: string[] = []): Promise<FeedItem[]> {
  return (await fetchFeedReport(name, url, alts)).items;
}

/**
 * WordPress JSON, for sites whose RSS lags the homepage. SpaceNews' RSS was stuck
 * on 19 Nov 2026 while the site itself was publishing on the 22nd and 23rd.
 */
export async function fetchWpPosts(name: string, url: string): Promise<FeedReport> {
  try {
    const res = await fetch(url, {
      headers: FEED_HEADERS,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = (await res.json()) as { date?: string; link?: string; title?: { rendered?: string }; excerpt?: { rendered?: string } }[];
    const items: FeedItem[] = [];
    for (const p of posts) {
      const when = p.date ? new Date(p.date) : null;
      const title = strip(p.title?.rendered);
      const link = p.link ?? "";
      if (!title || !when || isNaN(+when) || !/^https?:\/\//.test(link)) continue;
      items.push({ title, link, date: when.toISOString().slice(0, 10), summary: firstSentences(strip(p.excerpt?.rendered)), raw: p as unknown as Record<string, unknown> });
    }
    return { items };
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`Skipped ${name}: ${message}`);
    return { items: [], error: message };
  }
}
