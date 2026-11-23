/**
 * Sector, type, "why it matters", and brief-title rules for the free collector.
 * Scores keywords (title beats body; a hyphen is part of the word). A weak lead
 * sector, or a line that would only restate the sector, produces an empty why.
 */
import { bounded } from "./text.ts";

export { storyWhy } from "./why.ts";

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
    rule(w("corvette|warship|naval base|uncrewed surface|submarine|USV|UUV|unmanned surface|undersea|frigate|destroyer|carrier|shipbuilding|shipyard|Saronic"), 8, 4),
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

const PROPER = new Set("ukraine ukrainian russia russian libya libyan canada china iran nato benghazi moscow pentagon hegseth lockheed army navy mirage valkyrie pyka nightmare bragg benning mediterranean black".split(" "));

function sentenceCase(input: string): string {
  let seen = false;
  return input.replace(/[A-Za-z0-9][A-Za-z0-9'’%./-]*/g, (word) => {
    const first = !seen;
    seen = true;
    const stem = word.replace(/'s$/i, "").replace(/[^A-Za-z0-9]/g, "");
    if (/\d/.test(word) || (stem.length >= 2 && stem === stem.toUpperCase() && /[A-Z]/.test(stem))) return word;
    if (PROPER.has(stem.toLowerCase())) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    const lower = word.toLowerCase();
    if (first) return lower.charAt(0).toUpperCase() + lower.slice(1);
    return lower;
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
  t = sentenceCase(t).replace(/\bspace force\b/gi, "Space Force").replace(/\bblack sea\b/gi, "Black Sea").replace(/\bair force\b/gi, "Air Force");
  if (t.length > 92) t = t.slice(0, 89).replace(/\s+\S*$/, "").trim() + "…";
  return t;
}
