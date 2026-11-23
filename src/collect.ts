/**
 * Free daily collector: no API key. Pulls defense news RSS feeds, sorts articles
 * into sectors with scored keyword rules, writes new updates and (if no brief
 * exists yet for today) an automatic headline brief, then rebuilds the JSON API.
 *
 * C4ISRNET is not collected: its feed is Sightline video that Defense News already
 * publishes under the same headlines, so title dedup dropped every item.
 * CSIS rss.xml is a 2016 archive (the dates parse; nothing falls in the window)
 * and the site no longer offers a current feed.
 * GovConWire's own /feed/ returns 403; Feedburner still serves the same items.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fetchFeedReport, fetchWpPosts } from "./rss.ts";
import { loadDesk, saveDaily, slug } from "./store.ts";
import { buildApi } from "./build-api.ts";
import { tagCompanies } from "./companies.ts";
import { briefTitle, classify, storyWhy } from "./classify.ts";
import { briefSummary, pickTop, storyGist, storyScore } from "./brief.ts";
import { cleanCopy, polishWhys } from "./why.ts";
import { flaggedFeeds, updateFeedHealth, type FeedHealth, type FeedObservation } from "./feed-health.ts";
import { matchCompanies } from "./names.ts";
import type { Brief, Update } from "./schema.ts";

type Tier = "primary" | "news" | "research" | "aggregator";
const FEEDS: { name: string; url: string; tier: Tier; wp?: boolean }[] = [
  { name: "Breaking Defense", url: "https://breakingdefense.com/feed/", tier: "news" },
  { name: "DefenseScoop", url: "https://defensescoop.com/feed/", tier: "news" },
  { name: "Defense News", url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", tier: "news" },
  { name: "The War Zone", url: "https://www.twz.com/feed", tier: "news" },
  { name: "Air & Space Forces", url: "https://www.airandspaceforces.com/feed/", tier: "news" },
  { name: "USNI News", url: "https://news.usni.org/feed", tier: "news" },
  // The RSS file lags the site by days. The WordPress JSON is current.
  { name: "SpaceNews", url: "https://spacenews.com/wp-json/wp/v2/posts?per_page=15&_fields=date,link,title,excerpt", tier: "news", wp: true },
  { name: "GovConWire", url: "https://feeds.feedburner.com/govconwire", tier: "news" },
  { name: "Defense One", url: "https://www.defenseone.com/rss/all/", tier: "news" },
  { name: "U.S. Department of War", url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10", tier: "primary" },
  { name: "Defence Blog", url: "https://defence-blog.com/feed/", tier: "news" },
  { name: "ExecutiveGov", url: "https://www.executivegov.com/feed/", tier: "news" },
];

const NOISE = /\b(names?|appoints?|appointed|hires|joins as|promoted|to lead|steps down|retires|VP|vice president|chief (executive|operating|financial|technology) officer|admiral|one-star|two-star|webinar|podcast|week in review|newsletter|photos?:)\b/i;

const HEALTH_PATH = "data/feed-health.json";

interface Article { title: string; link: string; date: string; summary: string; source: (typeof FEEDS)[number] }

const today = process.env.DESK_DATE ?? new Date().toISOString().slice(0, 10);
const lookbackDays = Number(process.env.LOOKBACK_DAYS ?? 3);
const since = new Date(Date.parse(today) - lookbackDays * 864e5).toISOString().slice(0, 10);

const desk = await loadDesk();
const directory = desk.companies.map((c) => String(c.name));
const counts = new Map<string, FeedObservation>();

const batches = await Promise.all(FEEDS.map(async (feed) => {
  const report = feed.wp ? await fetchWpPosts(feed.name, feed.url) : await fetchFeedReport(feed.name, feed.url);
  const newest = report.items.reduce((m, i) => (i.date > m ? i.date : m), "");
  counts.set(feed.name, {
    name: feed.name,
    url: feed.url,
    fetched: report.items.length,
    inWindow: 0,
    added: 0,
    duplicates: 0,
    ...(newest ? { newest } : {}),
    ...(report.error ? { error: report.error } : {}),
  });
  return { feed, items: report.items };
}));

const articles: Article[] = [];
for (const { feed, items } of batches) {
  for (const item of items) {
    if (item.date < since || item.date > today) continue;
    counts.get(feed.name)!.inWindow++;
    articles.push({ title: item.title, link: item.link, date: item.date, summary: item.summary, source: feed });
  }
}
console.log(`Fetched ${articles.length} recent articles from ${FEEDS.length} feeds.`);

const knownUrls = new Set(desk.updates.map((u) => u.src?.u));
const knownIds = new Set(desk.updates.map((u) => u.id));
const addedAt = new Date().toISOString();
const added: (Update & { score: number; titleScore: number })[] = [];

for (const a of articles) {
  const { sectors, type } = classify(a.title, a.summary);
  if (!sectors.length) continue;
  if (NOISE.test(a.title)) continue;
  const id = `u-${a.date.replace(/-/g, "")}-${slug(a.title)}`;
  const row = counts.get(a.source.name)!;
  if (knownUrls.has(a.link) || knownIds.has(id)) {
    row.duplicates++;
    continue;
  }
  knownUrls.add(a.link);
  knownIds.add(id);
  const companies = matchCompanies(`${a.title} ${a.summary}`, directory);
  const titleScore = sectors[0].titleScore;
  row.added++;
  added.push({
    id, d: a.date, title: a.title, body: cleanCopy(a.summary || a.title), why: "",
    sectors: sectors.map((s) => s.id) as Update["sectors"], type: type as Update["type"], companies,
    src: { t: a.source.name, u: a.link, q: a.source.tier }, addedAt,
    score: 0, titleScore,
  } as Update & { score: number; titleScore: number });
}

const fresh = added.map(({ score, titleScore, ...u }) => u);
// Tag companies with the local Hugging Face NER model; keyword matches above still stand if it can't load.
try {
  if (fresh.length) console.log(`Tagged companies on ${await tagCompanies(desk, fresh)} updates that had none.`);
} catch (err) {
  console.warn(`Company tagging skipped: ${err instanceof Error ? err.message : err}`);
}
for (let i = 0; i < fresh.length; i++) {
  const u = fresh[i];
  const again = classify(u.title, u.body);
  u.body = cleanCopy(u.body);
  u.why = storyWhy(u.title, u.body, again.sectors[0], u.type, u.companies);
  added[i].score = storyScore({
    type: u.type, companies: u.companies, title: u.title, body: u.body,
    titleScore: again.sectors[0]?.titleScore ?? 0, primary: added[i].src?.q === "primary",
  });
  added[i].why = u.why;
  added[i].companies = u.companies;
}
const whyPack = fresh.map((u) => ({ id: u.id, title: u.title, body: u.body, why: u.why, sector: u.sectors[0] }));
await polishWhys(whyPack);
for (const row of whyPack) {
  const live = fresh.find((u) => u.id === row.id);
  const ranked = added.find((u) => u.id === row.id);
  if (live) live.why = row.why;
  if (ranked) ranked.why = row.why;
}
desk.updates.push(...fresh);
console.log(`Added ${added.length} new updates.`);

let priorHealth: FeedHealth | null = null;
try {
  priorHealth = JSON.parse(await readFile(HEALTH_PATH, "utf8")) as FeedHealth;
} catch { /* first run */ }
const health = updateFeedHealth(priorHealth, [...counts.values()], today, addedAt);
await writeFile(HEALTH_PATH, JSON.stringify(health, null, 2) + "\n");
const flags = flaggedFeeds(health);
for (const row of counts.values()) {
  const flag = flags.find((f) => f.name === row.name);
  const line = `${row.name}: fetched ${row.fetched}, in window ${row.inWindow}, added ${row.added}`;
  if (flag) console.warn(`Feed health FLAG ${line} — ${flag.flag}`);
  else console.log(`Feed ${line}`);
}

// Free brief: only when nothing (e.g. a Claude-written brief) exists for today yet.
let brief: Brief | null = null;
if (!desk.briefs.some((b) => b.date === today) && added.length) {
  const prior = desk.updates.filter((u) => u.d < today && u.d >= new Date(Date.parse(today) - 3 * 864e5).toISOString().slice(0, 10));
  const picked = pickTop(added, 5, prior);
  const sectorName = (id: string) => desk.sectors.find((s) => s.id === id)?.name ?? id;
  const next = desk.catalysts.filter((c) => c.d >= today).sort((a, b) => a.d.localeCompare(b.d))[0];
  const idea = desk.ideas.length ? desk.ideas[Math.floor(Date.parse(today) / 864e5) % desk.ideas.length] : null;
  const lead = picked[0];
  if (!lead) {
    console.log("Every new story repeats an event from the last three days. No brief.");
  } else brief = {
    date: today,
    title: briefTitle(lead.title, lead.body),
    big: briefSummary(picked.length, added.map((u) => u.sectors[0]), picked.map((u) => u.sectors[0]), {
      gist: picked.length === 1 ? storyGist(picked[0].title, picked[0].body) : undefined,
      text: picked.map((u) => `${u.title} ${u.body}`).join(" "),
    }),
    stories: picked.map((u) => ({ tag: sectorName(u.sectors[0]), h: u.title, what: u.body, you: u.why, ref: u.id })),
    watch: next ? { h: next.title, why: `${next.approx ? "Around " : ""}${new Date(next.d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}. ${next.why}` } : { h: "Nothing scheduled", why: "" },
    idea: idea ? { h: String(idea.t), why: `${idea.what} ${idea.why}` } : { h: "", why: "" },
    auto: true,
  } as Brief & { auto: boolean };
  if (brief) desk.briefs.push(brief);
}

desk.meta = { ...desk.meta, collectedAt: addedAt, feedHealth: { checkedAt: addedAt, flags } };
await saveDaily(desk, brief);
await buildApi(desk);
console.log(brief ? `Wrote the ${today} brief with ${brief.stories.length} stories.` : "Brief for today already exists or nothing new; kept it.");
