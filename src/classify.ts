/**
 * Sector, type, "why it matters", and brief-title rules for the free collector.
 * Scores keywords (title beats body; a hyphen is part of the word). A weak lead
 * sector, or a line that would only restate the sector, produces an empty why.
 */
import { bounded } from "./text.ts";

const w = bounded;

export interface SectorHit {
  id: string;
  score: number;
  /** Points earned from the headline alone. Below 4, the why line is omitted. */
  titleScore: number;
}

interface Rule { re: RegExp; title: number; body: number }
interface Spec { id: string; priority: number; rules: Rule[] }

const rule = (re: RegExp, title: number, body: number): Rule => ({ re, title, body });

// priority breaks ties only. A program in the headline outscores a country or a prime.
const SPECS: Spec[] = [
  { id: "ai", priority: 50, rules: [
    rule(w("artificial intelligence|machine learning|\\bLLM|Palantir|Maven|CDAO|Scale AI|JADC2|CJADC2|data platform"), 6, 3),
    rule(w("AI|command and control|C2"), 4, 2),
    rule(w("software|algorithm"), 2, 1),
  ]},
  { id: "air", priority: 58, rules: [
    rule(w("drones?|UAS|UAV|unmanned aircraft|loitering munition|CCA|collaborative combat aircraft|FPV|Drone Dominance|Replicator|F-35s?|F-47s?|B-21s?|bombers?|Shield AI"), 6, 3),
    rule(w("fighter"), 4, 2),
    rule(w("aircraft"), 2, 1),
  ]},
  { id: "sea", priority: 56, rules: [
    rule(w("submarine|USV|UUV|unmanned surface|undersea|frigate|destroyer|carrier|shipbuilding|shipyard|Saronic"), 6, 3),
    rule(w("ships?|maritime"), 4, 2),
    rule(w("Navy"), 2, 1),
  ]},
  { id: "ground", priority: 54, rules: [
    rule(w("ground robots?|UGV|unmanned ground|robotic combat vehicle|Abrams|tank"), 6, 3),
    rule(w("armou?red|infantry fighting"), 4, 2),
  ]},
  { id: "space", priority: 60, rules: [
    rule(w("Space Force|satellite|orbit|Starshield|SpaceX|constellation|SDA"), 6, 3),
    rule(w("space"), 4, 2),
    rule(w("launch"), 2, 1),
  ]},
  { id: "missiledef", priority: 85, rules: [
    rule(w("missile defen[cs]e|Golden Dome|THAAD|Patriot|SM-3|SM-6|air defen[cs]e|Iron Dome"), 6, 3),
    rule(w("interceptor(?!\\s+drone)"), 4, 2),
  ]},
  { id: "strike", priority: 80, rules: [
    rule(w("hypersonic|munitions?|missiles?|rocket artillery|rocket motor|artillery|PrSM|JASSM|LRASM|Tomahawk|HIMARS|PULS|anti-tank|ICBMs?"), 6, 3),
    rule(w("strike weapon|shells?"), 4, 2),
  ]},
  { id: "cuas", priority: 90, rules: [
    rule(w("counter[-\\s]?drones?|counter[-\\s]?UAS|C-UAS|directed energy|laser weapons?|high-energy lasers?|high-power microwave|HPM|Epirus|interceptor drones?|lasers?"), 6, 3),
  ]},
  { id: "ew", priority: 68, rules: [
    rule(w("electronic warfare|jamming|jammer|signals intelligence|SIGINT|GPS-denied"), 6, 3),
    rule(w("EW|spectrum"), 3, 1),
  ]},
  { id: "cyber", priority: 70, rules: [
    rule(w("ransomware|Salt Typhoon|Volt Typhoon|zero trust|CYBERCOM|malware|hackers?|hacked|hacking"), 6, 3),
    rule(w("cyber"), 4, 2),
  ]},
  { id: "sensing", priority: 66, rules: [
    rule(w("radar|ISR|quantum sensing"), 6, 3),
    rule(w("sensor|surveillance|reconnaissance"), 4, 2),
  ]},
  { id: "mfg", priority: 46, rules: [
    rule(w("production line|industrial base|Arsenal-\\d|Hadrian|DPA Title III"), 6, 3),
    rule(w("factory|manufactur(?:ing|er)|supply chain"), 4, 2),
  ]},
  { id: "minerals", priority: 48, rules: [
    rule(w("rare earths?|critical minerals?|MP Materials|gallium|germanium|antimony"), 6, 3),
    rule(w("magnets?|lithium|export control"), 4, 2),
  ]},
  { id: "energy", priority: 44, rules: [
    rule(w("microreactor|nuclear power|Project Pele|power grid"), 6, 3),
    rule(w("reactor|batteries"), 4, 2),
  ]},
  { id: "bio", priority: 42, rules: [
    rule(w("biomanufactur\\w*|biodefen[cs]e|pathogen|biotech|bioindustrial|biological weapon"), 6, 3),
  ]},
  { id: "policy", priority: 40, rules: [
    rule(w("NDAA|appropriations|continuing resolution|acquisition reform|executive order|House Armed Services|Hegseth|confirmation"), 5, 3),
    rule(w("Senate|Congress|lawmakers|budget|grills"), 5, 2),
  ]},
  { id: "capital", priority: 30, rules: [
    rule(w("funding round|Series [A-H]|IPO|SPAC|venture capital"), 6, 3),
    rule(/raises?\s+\$\d|raised\s+\$\d/i, 6, 3),
    rule(w("valuation|acquires|acquisition of|merger"), 4, 2),
  ]},
  { id: "primes", priority: 20, rules: [
    rule(w("Lockheed|Raytheon|RTX|Northrop|General Dynamics|L3Harris|Boeing Defense|BAE Systems|Huntington Ingalls|Leidos|SAIC"), 3, 2),
  ]},
  { id: "global", priority: 18, rules: [
    rule(w("Ukraine|NATO|Israel|Taiwan|Japan|Australia|AUKUS|Europe(?:an)?|Germany|Poland|UK|Britain|South Korea|India|Philippines"), 3, 1),
  ]},
  { id: "adversary", priority: 15, rules: [
    rule(w("China|Chinese|PLA|Russians?|Russia|Iran(?:ian)?|North Korea|Beijing|Moscow|Kremlin|Houthi"), 3, 1),
  ]},
];

function scoreSpec(spec: Spec, title: string, body: string): { score: number; titleScore: number } {
  let score = 0;
  let titleScore = 0;
  for (const r of spec.rules) {
    if (r.re.test(title)) {
      score += r.title;
      titleScore += r.title;
    } else if (body && r.re.test(body)) score += r.body;
  }
  return { score, titleScore };
}

/** Headline-only. No match means no type, rather than a default of "Tech milestone". */
const TYPE_RULES: [string, RegExp][] = [
  ["Funding", /raises?\s+\$\d|raised\s+\$\d|(?<![\p{L}\p{N}_-])(?:funding round|Series\s+[A-H]|venture capital)(?![\p{L}\p{N}_-])/iu],
  ["M&A & IPO", /(?<![\p{L}\p{N}_-])(?:acquires|acquired|acquisition of|merger|to acquire|IPO|SPAC|goes public)(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_-])bids?\s+\S.{0,50}\sfor\b/iu],
  ["Earnings", w("earnings|quarterly results|guidance|lifts .{0,40}forecast")],
  ["Contract", /(?<![\p{L}\p{N}_-])(?:awards?|awarded|contracts?|IDIQ|OTA|task order|purchase order|selects|selected|orders|green light to buy|foreign military sale)(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_-])(?:wins?|gets?|pays|paying|books?|receives?|received)(?![\p{L}\p{N}_-]).{0,48}\$\d/iu],
  ["Policy & budget", w("budget|NDAA|appropriations|executive order|Hegseth|lawmakers|Senate|Congress|confirmation|grills|continuing resolution")],
  ["Research", w("report finds|study finds|analysis finds|think tank|white paper")],
  ["Conflict & allies", w("attacks?|invasion|airstrike|missile strike|drone strike|shot down")],
  ["Tech milestone", w("test-?fires?|test launch|prototype|first flight|first time|downs|destroys|demonstrates|fielded")],
];

export function classify(title: string, body: string): { sectors: SectorHit[]; type: string } {
  const sectors = SPECS
    .map((spec) => ({ id: spec.id, priority: spec.priority, ...scoreSpec(spec, title, body) }))
    .filter((h) => h.score >= 2)
    .sort((a, b) => b.score - a.score || b.priority - a.priority)
    .slice(0, 4)
    .map(({ id, score, titleScore }) => ({ id, score, titleScore }));
  const type = TYPE_RULES.find(([, re]) => re.test(title))?.[0] ?? "";
  return { sectors, type };
}

const PROGRAMS = [
  "Space Force", "Golden Dome", "rocket artillery", "cruise missile", "high-energy laser",
  "HIMARS", "PULS", "F-35", "F-47", "B-21", "Valkyrie", "Patriot", "THAAD", "Iron Dome",
  "Tomahawk", "JASSM", "LRASM", "Starshield", "Stryker", "Minuteman", "Drone Dominance",
  "counter-drone", "Replicator", "anti-tank missile", "Block 4", "Stinger", "SEWIP", "155mm",
];

const ACTORS = ["Senate", "Congress", "Pentagon", "White House", "NATO", "Army", "Navy", "Air Force", "Space Force", "Marines", "Hegseth"];
const STOP = new Set("the a an how why what watch after inside new tiny us u.s. as in on for to and".split(" "));
const VERB = new Set("backs says gets wins won buys announces reports plans seeks faces grills makes shows begins fires tests gives gave offers offer taps selects awards approved cleared books".split(" "));

function findActor(title: string): string | undefined {
  for (const a of ACTORS) if (w(a).test(title)) return a;
  const words = title.replace(/[“”"']/g, "").split(/\s+/);
  const out: string[] = [];
  for (const word of words) {
    const core = word.replace(/[^A-Za-z0-9'’.-]/g, "");
    if (!core || STOP.has(core.toLowerCase())) {
      if (out.length) break;
      continue;
    }
    if (VERB.has(core.toLowerCase())) break;
    if (!/^[\p{Lu}\d]/u.test(core)) break;
    out.push(core);
    if (out.length === 3) break;
  }
  return out.join(" ") || undefined;
}

function findMoney(text: string): string | undefined {
  const spelled = /\$\s?(\d+(?:\.\d+)?)\s?(billion|million)\b/i.exec(text);
  if (spelled) return `$${spelled[1]} ${spelled[2].toLowerCase()}`;
  const under = /\bunder\s+\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/i.exec(text);
  if (under) return `under $${under[1]}`;
  const short = /\$\s?(\d+(?:\.\d+)?)\s?(bn|m|b)\b/i.exec(text);
  if (short) return `$${short[1]} ${/^b/i.test(short[2]) ? "billion" : "million"}`;
  const commas = /\$\s?(\d{1,3}(?:,\d{3})+)/.exec(text);
  if (commas) return `$${commas[1]}`;
  return undefined;
}

function programsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return PROGRAMS.filter((p) => lower.includes(p.toLowerCase()))
    .sort((a, b) => lower.indexOf(a.toLowerCase()) - lower.indexOf(b.toLowerCase()) || b.length - a.length);
}

function programName(text: string): string | undefined {
  const found = programsIn(text);
  if (found.includes("F-35") && found.includes("Block 4")) return "F-35 Block 4";
  return found[0];
}

const SERVICES = ["U.S. Navy", "U.S. Army", "Air Force", "Space Force", "Navy", "Army", "Senate", "Congress", "Pentagon", "Hegseth"];

function serviceOf(text: string): string | undefined {
  return SERVICES.find((s) => new RegExp(`\\b${s.replace(".", "\\.")}\\b`, "i").test(text));
}

function sentencesOf(text: string): string[] {
  const cleaned = text
    .replace(/^[A-Z][A-Za-z .]+,\s+[A-Z][a-z]+\s*[—–-]\s*/, "")
    .replace(/,?\s*the company said\b[^.]*/gi, "")
    .replace(/,?\s*according to\b[^.]*/gi, "")
    .replace(/,?\s*officials familiar\b[^.]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .replace(/\b(U\.S|Nov|Mr|Mrs|Dr|Gen|Lt|Col|St)\./g, "$1\u0000")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter((s) => s.length > 30);
}

function named(s?: string): string | undefined {
  if (!s) return;
  if (/^(Hegseth|Senate|Congress|Pentagon)$/i.test(s)) return s;
  if (/^The\b/i.test(s)) return s;
  if (/^(U\.S\. )?(Navy|Army|Air Force|Space Force)$/i.test(s)) return `The ${s}`;
  return s;
}

function purposeOf(text: string): string | undefined {
  const m = text.match(/\bto (accelerate|speed up|replace|develop|upgrade)([^.”"]{6,100})/i);
  if (!m) return;
  return `to ${m[1].toLowerCase()}${m[2]}`.replace(/\s+/g, " ").replace(/[,;]\s*$/, "").trim();
}

function clip(s: string, max = 220): string {
  let t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return /[.!?]$/.test(t) ? t : `${t}.`;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(". "));
  t = (end > 60 ? cut.slice(0, end) : cut.replace(/\s+\S*$/, "")).replace(/[,;:]\s*$/, "").trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * One sentence drawn from this story's own actor, figure, and program.
 * A weak sector score used to return "" and a matched template used to append
 * the same closer to every deal. Both are gone: the line is this story's facts,
 * and the lede itself is the fallback so the result is never empty.
 */
export function storyWhy(title: string, body: string, _lead?: SectorHit, _type?: string, companies: string[] = []): string {
  const blob = `${title}. ${body}`.replace(/\s+/g, " ").trim();
  const money = findMoney(blob);
  const pct = /\b(\d{1,3}(?:\.\d+)?)\s*percent\b/i.exec(blob)?.[1];
  const program = programName(blob);
  const company = companies[0];
  const service = serviceOf(blob);
  const who = company || service || findActor(title);
  const purpose = purposeOf(blob);
  const when = /\bmid-\d{4}\b|\bby (?:early |late )?\d{4}\b/i.exec(blob)?.[0];
  const firms = /\b(\d{1,3}) companies\b/i.exec(blob)?.[1];
  const fold = /\b([a-z]+-fold|\d+-fold)\b/i.exec(blob)?.[1];

  let line = "";
  const payer = named(service);
  if (payer && company && money && program && /under/i.test(money) === false && /speed up|accelerat|delay/i.test(blob)) {
    line = `${payer} is paying ${company} ${money} to pull the delayed ${program} upgrade forward.`;
  } else if (payer && company && money && program) {
    line = `${payer} is paying ${company} ${money} for ${program}${purpose ? `, ${purpose}` : ""}.`;
  } else if (money && /under/i.test(money) && program) {
    line = `${payer || named(who) || "The buyer"} priced a ${program} replacement at ${money}${/per missile/i.test(blob) ? " per missile" : ""}${when ? `, with a live-fire shootout ${when}` : ""}.`;
  } else if (pct && program && money) {
    const from = /\$\s?(\d+(?:\.\d+)?)\s?(billion|million)\b/gi;
    const amounts = [...blob.matchAll(from)].map((m) => `$${m[1]} ${m[2].toLowerCase()}`);
    const prior = amounts[1];
    line = `${payer || named(who) || "Appropriators"} set ${program} ${pct}% higher, at ${amounts[0] || money}${prior ? ` from ${prior}` : ""}.`;
  } else if (/\b(limits?|restrict\w*|ordered new limits)\b/i.test(blob) && who) {
    const on = blob
      .replace(/\b(U\.S|Nov|Mr|St)\./g, "$1\u0000")
      .match(/\blimits\s+on\s+(.+?)(?:,|\.\s|$)/i)?.[1]
      ?.replace(/\u0000/g, ".")
      .trim();
    line = `${named(who) || who} ordered limits on ${on || "the relationship in this story"}.`;
  } else if (firms && money) {
    line = `${payer || named(who) || "The buyer"} put ${firms} companies on a ${money} vehicle${program ? ` for ${program}` : ""}.`;
  } else if (fold && (company || who)) {
    line = `${company || who} opened a plant it says will raise ${program || "shell"} output ${fold}.`;
  } else if (/green light to buy|foreign military sale|state department approved/i.test(blob) && (program || money)) {
    line = `${service || "The State Department"} approved ${money ? `a ${money} sale` : "a sale"}${program ? ` of ${program}` : ""}${who && who !== service ? ` for ${who}` : ""}.`;
  } else if (company && program && /laser|destroyed|downs/i.test(blob)) {
    const target = /cruise missile/i.test(blob) ? "a cruise-missile target" : "a target";
    line = `${company}'s ${program} ${/destroyed|downs/i.test(blob) ? `destroyed ${target}` : "was demonstrated"}${/first time/i.test(blob) ? " for the first time" : ""}.`;
  }

  if (!line) {
    const sents = sentencesOf(body || title);
    line = sents[1] && /\$|\d{4}|program|contract|shootout|plant|squadron/i.test(sents[1]) ? sents[1] : (sents[0] || title);
  }
  const out = clip(line);
  return out || title.trim() || "This story has no further detail.";
}

const SMALL = new Set("a an the and but or nor of to for in on by with from at as into over after before than its their his her about amid during while against across per via backs bigger trims says gets wins won new more most will would could should has have had are was were is be been not its".split(" "));

function sentenceCase(input: string): string {
  let seen = false;
  return input.replace(/[A-Za-z0-9][A-Za-z0-9'’%./-]*/g, (word) => {
    const first = !seen;
    seen = true;
    if (/\d/.test(word) || (word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word))) return word;
    const lower = word.toLowerCase();
    if (!first && SMALL.has(lower)) return lower;
    if (first) return lower.charAt(0).toUpperCase() + lower.slice(1);
    return word;
  });
}

/** Brief headline taken from the lead story, with the standout percent folded in when the headline says "bigger". */
export function briefTitle(title: string, body: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  const colon = t.indexOf(": ");
  if (colon >= 28) t = t.slice(0, colon).trim();
  t = t.replace(/,\s+but\b.*$/i, "").trim();
  const pct = /\b(\d{1,3}(?:\.\d+)?)\s*percent\b/i.exec(`${body} ${title}`)?.[1];
  if (pct && !t.includes("%") && !t.includes(pct)) t = t.replace(/\bbigger\b/i, `a ${pct}% bigger`);
  t = sentenceCase(t);
  if (t.length > 92) t = t.slice(0, 89).replace(/\s+\S*$/, "").trim() + "…";
  return t;
}
