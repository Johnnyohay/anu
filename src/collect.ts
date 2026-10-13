/**
 * Free daily collector: no AI, no API key. Pulls defense news RSS feeds, sorts
 * articles into sectors with keyword rules, writes new updates and (if no brief
 * exists yet for today) an automatic headline brief, then rebuilds the JSON API.
 */
import { XMLParser } from "fast-xml-parser";
import { loadDesk, saveDaily, slug } from "./store.ts";
import { buildApi } from "./build-api.ts";
import { tagCompanies } from "./companies.ts";
import type { Brief, Update } from "./schema.ts";

type Tier = "primary" | "news" | "research" | "aggregator";
const FEEDS: { name: string; url: string; tier: Tier }[] = [
  { name: "Breaking Defense", url: "https://breakingdefense.com/feed/", tier: "news" },
  { name: "DefenseScoop", url: "https://defensescoop.com/feed/", tier: "news" },
  { name: "Defense News", url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", tier: "news" },
  { name: "The War Zone", url: "https://www.twz.com/feed", tier: "news" },
  { name: "Air & Space Forces", url: "https://www.airandspaceforces.com/feed/", tier: "news" },
  { name: "USNI News", url: "https://news.usni.org/feed", tier: "news" },
  { name: "SpaceNews", url: "https://spacenews.com/feed/", tier: "news" },
  { name: "C4ISRNET", url: "https://www.c4isrnet.com/arc/outboundfeeds/rss/?outputType=xml", tier: "news" },
  { name: "GovConWire", url: "https://www.govconwire.com/feed/", tier: "news" },
  { name: "Defense One", url: "https://www.defenseone.com/rss/all/", tier: "news" },
  { name: "U.S. Department of War", url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10", tier: "primary" },
  { name: "CSIS", url: "https://www.csis.org/rss.xml", tier: "research" },
  { name: "Defence Blog", url: "https://defence-blog.com/feed/", tier: "news" },
  { name: "ExecutiveGov", url: "https://www.executivegov.com/feed/", tier: "news" },
];

// Keyword rules per sector. Word boundaries keep "AI" from matching "said".
const SECTOR_RULES: Record<string, RegExp> = {
  ai: /\b(AI|artificial intelligence|machine learning|LLM|Palantir|Maven|software|algorithm|CDAO|Scale AI|data platform|command and control|C2|JADC2|CJADC2)\b/i,
  air: /\b(drones?|UAS|UAV|unmanned aircraft|loitering munition|CCA|collaborative combat aircraft|Fury|Shield AI|FPV|Drone Dominance|Replicator|fighter|aircraft|F-35|F-47|B-21)\b/i,
  sea: /\b(Navy|ship(s|building|yard)?|submarine|USV|UUV|unmanned surface|undersea|maritime|Saronic|frigate|destroyer|carrier)\b/i,
  ground: /\b(ground robot|UGV|unmanned ground|robotic combat vehicle|tank|Abrams|armored|infantry|Army Transformation)\b/i,
  space: /\b(space|satellite|orbit|launch|Space Force|SDA|Starshield|SpaceX|constellation|rocket)\b/i,
  missiledef: /\b(missile defen[cs]e|Golden Dome|interceptor|THAAD|Patriot|SM-3|SM-6|air defen[cs]e|Iron Dome)\b/i,
  strike: /\b(hypersonic|munitions?|missile|rocket motor|artillery|shell production|PrSM|JASSM|LRASM|Tomahawk|strike weapon)\b/i,
  cuas: /\b(counter-?drone|counter-?UAS|C-UAS|directed energy|laser weapon|high-power microwave|HPM|Epirus|interceptor drone)\b/i,
  ew: /\b(electronic warfare|EW|jamm(ing|er)|spectrum|signals intelligence|SIGINT|GPS-denied)\b/i,
  cyber: /\b(cyber|hack(ers|ed|ing)?|ransomware|Salt Typhoon|Volt Typhoon|zero trust|CYBERCOM|malware)\b/i,
  sensing: /\b(sensor|radar|ISR|surveillance|reconnaissance|quantum|intelligence collection)\b/i,
  mfg: /\b(factory|manufactur(ing|er)|production line|industrial base|supply chain|Arsenal-\d|Hadrian|shipyard capacity|DPA Title III)\b/i,
  minerals: /\b(rare earth|critical minerals?|magnets?|lithium|gallium|germanium|antimony|MP Materials|export control)\b/i,
  energy: /\b(microreactor|nuclear power|reactor|energy|battery|batteries|power grid|Janus|Project Pele)\b/i,
  bio: /\b(biotech|bioindustrial|biomanufacturing|biodefen[cs]e|pathogen|biological)\b/i,
  policy: /\b(budget|NDAA|Congress|appropriations|continuing resolution|Pentagon policy|Hegseth|acquisition reform|executive order|Senate|House Armed Services|lawmakers)\b/i,
  capital: /\b(funding round|raises? \$|raised \$|Series [A-H]\b|valuation|venture capital|IPO|SPAC|acquires|to (buy|acquire)|acquisition of|merger)/i,
  primes: /\b(Lockheed|Raytheon|RTX|Northrop|General Dynamics|L3Harris|Boeing Defense|BAE Systems|Huntington Ingalls|Leidos|SAIC)\b/i,
  global: /\b(Ukraine|NATO|Israel|Taiwan|Japan|Australia|AUKUS|Europe(an)?|Germany|Poland|UK|Britain|South Korea|India|Philippines)\b/i,
  adversary: /\b(China|Chinese|PLA|Russia(n)?|Iran(ian)?|North Korea|Beijing|Moscow|Kremlin|Houthi)\b/i,
};

const TYPE_RULES: [Update["type"], RegExp][] = [
  ["Funding", /\b(raises? \$|raised \$|Series [A-H]\b|funding round|valuation)/i],
  ["M&A & IPO", /\b(acquires?|acquisition of|merger|IPO|SPAC|to buy|goes public)\b/i],
  ["Earnings", /\b(earnings|quarterly results|Q[1-4] (results|revenue)|backlog|guidance)\b/i],
  ["Contract", /\b(awards?|awarded|contracts?|IDIQ|OTA|task order|orders?|selects?|selected|wins|won|taps)\b/i],
  ["Policy & budget", /\b(budget|NDAA|Congress|appropriations|policy|executive order|Hegseth|lawmakers|bill)\b/i],
  ["Research", /\b(report|study|analysis|CSIS|RAND|CNAS|think tank)\b/i],
  ["Conflict & allies", /\b(Ukraine|Israel|Taiwan|NATO|Russia|China|Iran|strike on|attack)\b/i],
];

// What an article in each sector usually means for a founder: used in the free brief.
const SECTOR_SO_WHAT: Record<string, string> = {
  ai: "Software that decides what to look at and what to hit is where the most value is moving.",
  air: "Drones are becoming the military's default purchase, so volume, price and reliability decide who wins.",
  sea: "The Navy is short of ships and is turning to cheaper unmanned boats, which opens the door to new builders.",
  ground: "Ground robots are moving from demos to real orders, starting with logistics and dangerous jobs.",
  space: "More of the military's sensing and communications now runs through orbit, and new suppliers are getting in.",
  missiledef: "Missile defense is one of the biggest budget lines this decade, and its software and sensors are open to newcomers.",
  strike: "Weapons stockpiles are short, so anyone who can make missiles and rocket motors faster and cheaper has buyers.",
  cuas: "Stopping cheap drones cheaply is the industry's most urgent problem and one of its fastest-growing markets.",
  ew: "Jamming and spectrum fights decide whether drones and radios work at all, so this quiet area keeps getting funded.",
  cyber: "State hackers are still inside critical networks, which keeps defensive and offensive cyber in demand.",
  sensing: "Better sensors and navigation that works without GPS are prerequisites for everything autonomous.",
  mfg: "Being able to produce at scale has become a competitive edge in its own right; factories are now a venture category.",
  minerals: "Whoever controls materials such as rare-earth magnets controls what can be built; supply-chain tools and substitutes are in demand.",
  energy: "Bases need their own power for AI, sensors and lasers, which creates a defense market for new energy tech.",
  bio: "Biomanufacturing could replace parts of supply chains that depend on adversaries.",
  policy: "Budget and policy moves decide which programs get real money and when; they're the earliest signal of demand.",
  capital: "Where investors put money shows which parts of the industry they expect to win next.",
  primes: "The big incumbents are growing too. Watch where they partner with or buy startups rather than compete.",
  global: "Allies' wars and budgets are the testing ground and a big second market for new defense tech.",
  adversary: "What China, Russia and Iran field sets the requirements the Pentagon buys against.",
};

const NOISE = /\b(names?|appoints?|appointed|hires|joins as|promoted|to lead|steps down|retires|VP|vice president|chief (executive|operating|financial|technology) officer|webinar|podcast|week in review|newsletter|photos?:)\b/i;

const TYPE_WEIGHT: Record<string, number> = {
  Contract: 3, Funding: 3, "Policy & budget": 3, "M&A & IPO": 3, Earnings: 2, "Tech milestone": 2, "Conflict & allies": 2, Research: 1,
};

const parser = new XMLParser({ ignoreAttributes: false });
const strip = (s: unknown) =>
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
const firstSentences = (s: string, max = 260) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
};

interface Article { title: string; link: string; date: string; summary: string; source: (typeof FEEDS)[number] }

async function fetchFeed(feed: (typeof FEEDS)[number]): Promise<Article[]> {
  try {
    const res = await fetch(feed.url, { headers: { "user-agent": "Mozilla/5.0 (anu news collector)" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = parser.parse(await res.text());
    const items = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
    return (Array.isArray(items) ? items : [items]).flatMap((it: Record<string, unknown>) => {
      const link = typeof it.link === "string" ? it.link : (it.link as Record<string, string>)?.["@_href"] ?? "";
      const raw = (it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]) as string | undefined;
      const when = raw ? new Date(raw) : null;
      const title = strip(it.title);
      if (!title || !/^https?:\/\//.test(link) || !when || isNaN(+when)) return [];
      return [{ title, link: link.trim(), date: when.toISOString().slice(0, 10), summary: firstSentences(strip(it.description ?? it.summary ?? it["content:encoded"])), source: feed }];
    });
  } catch (err) {
    console.warn(`Skipped ${feed.name}: ${(err as Error).message}`);
    return [];
  }
}

const today = process.env.DESK_DATE ?? new Date().toISOString().slice(0, 10);
const lookbackDays = Number(process.env.LOOKBACK_DAYS ?? 3);
const since = new Date(Date.parse(today) - lookbackDays * 864e5).toISOString().slice(0, 10);

const desk = await loadDesk();
const articles = (await Promise.all(FEEDS.map(fetchFeed))).flat().filter((a) => a.date >= since && a.date <= today);
console.log(`Fetched ${articles.length} recent articles from ${FEEDS.length} feeds.`);

const knownUrls = new Set(desk.updates.map((u) => u.src?.u));
const knownIds = new Set(desk.updates.map((u) => u.id));
const addedAt = new Date().toISOString();
const added: (Update & { score: number })[] = [];

for (const a of articles) {
  const text = `${a.title} ${a.summary}`;
  const sectors = Object.entries(SECTOR_RULES).filter(([, re]) => re.test(text)).map(([id]) => id);
  if (!sectors.length) continue; // not about defense tech in a way we track
  if (NOISE.test(a.title)) continue; // personnel moves, events listings, opinion roundups
  const id = `u-${a.date.replace(/-/g, "")}-${slug(a.title)}`;
  if (knownUrls.has(a.link) || knownIds.has(id)) continue;
  knownUrls.add(a.link);
  knownIds.add(id);
  const type = TYPE_RULES.find(([, re]) => re.test(text))?.[0] ?? "Tech milestone";
  const companies = desk.companies
    .map((c) => String(c.name))
    .filter((name) => name.split(/ · | \/ /).some((n) => n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)));
  const titleSectors = sectors.filter((s) => SECTOR_RULES[s].test(a.title));
  const titleSector = titleSectors[0] ?? sectors[0];
  // Lead with the sectors the headline itself is about.
  sectors.sort((x, y) => Number(titleSectors.includes(y)) - Number(titleSectors.includes(x)));
  added.push({
    id, d: a.date, title: a.title, body: a.summary || a.title, why: SECTOR_SO_WHAT[titleSector] ?? "",
    sectors: sectors.slice(0, 4) as Update["sectors"], type, companies,
    src: { t: a.source.name, u: a.link, q: a.source.tier }, addedAt, auto: true,
    score: (TYPE_WEIGHT[type] ?? 1) + companies.length * 2 + titleSectors.length * 2 + (/\$\d/.test(a.title) ? 2 : 0) + (a.source.tier === "primary" ? 1 : 0),
  } as Update & { score: number; auto: boolean });
}

const fresh = added.map(({ score, ...u }) => u);
// Tag companies with the local Hugging Face NER model; keyword matches above still stand if it can't load.
try {
  if (fresh.length) console.log(`Tagged companies on ${await tagCompanies(desk, fresh)} updates that had none.`);
} catch (err) {
  console.warn(`Company tagging skipped: ${err instanceof Error ? err.message : err}`);
}
desk.updates.push(...fresh);
console.log(`Added ${added.length} new updates.`);

// Free brief: only when nothing (e.g. a Claude-written brief) exists for today yet.
let brief: Brief | null = null;
if (!desk.briefs.some((b) => b.date === today) && added.length) {
  const picked: typeof added = [];
  const usedSectors = new Set<string>();
  for (const u of [...added].sort((a, b) => b.score - a.score || b.d.localeCompare(a.d))) {
    const lead = u.sectors[0];
    if (usedSectors.has(lead) && picked.length < added.length - 1) continue; // spread across sectors
    picked.push(u);
    usedSectors.add(lead);
    if (picked.length === 5) break;
  }
  const sectorName = (id: string) => desk.sectors.find((s) => s.id === id)?.name ?? id;
  const counts = new Map<string, number>();
  added.forEach((u) => u.sectors.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1)));
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => sectorName(s).toLowerCase());
  const next = desk.catalysts.filter((c) => c.d >= today).sort((a, b) => a.d.localeCompare(b.d))[0];
  const idea = desk.ideas.length ? desk.ideas[Math.floor(Date.parse(today) / 864e5) % desk.ideas.length] : null;
  brief = {
    date: today,
    title: "Today's top defense-tech headlines",
    big: `${added.length} new stories since the last brief. The busiest areas: ${busiest.join(" and ")}.`,
    stories: picked.map((u) => ({ tag: sectorName(u.sectors[0]), h: u.title, what: u.body, you: u.why, ref: u.id })),
    watch: next ? { h: next.title, why: `${next.approx ? "Around " : ""}${new Date(next.d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}. ${next.why}` } : { h: "Nothing scheduled", why: "" },
    idea: idea ? { h: String(idea.t), why: `${idea.what} ${idea.why}` } : { h: "", why: "" },
    auto: true,
  } as Brief & { auto: boolean };
  desk.briefs.push(brief);
}

desk.meta = { ...desk.meta, collectedAt: addedAt };
await saveDaily(desk, brief);
await buildApi(desk);
console.log(brief ? `Wrote the ${today} brief with ${brief.stories.length} stories.` : "Brief for today already exists or nothing new; kept it.");
