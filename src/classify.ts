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
  "counter-drone", "Replicator", "anti-tank missile",
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

function findProgram(title: string): string | undefined {
  return PROGRAMS
    .map((p) => ({ p, at: title.toLowerCase().indexOf(p.toLowerCase()) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at || b.p.length - a.p.length)[0]?.p;
}

function moneyOf(text: string): string | undefined {
  const m = /\$\s?(\d+(?:\.\d+)?)\s?(billion|million|bn|m)\b/i.exec(text);
  if (!m) return;
  const unit = /^b/i.test(m[2]) ? "billion" : "million";
  return `$${m[1]} ${unit}`;
}

/**
 * One sentence a deployment strategist would actually say about this story.
 * Empty when the lead sector is only a weak or body-only match, or when the
 * story has no actor, program, or figure to hang a conclusion on.
 */
export function storyWhy(title: string, body: string, lead: SectorHit | undefined, type: string, companies: string[]): string {
  if (!lead || lead.titleScore < 4) return "";
  const blob = `${title}. ${body}`;
  const money = moneyOf(blob);
  const pct = /\b(\d{1,3}(?:\.\d+)?)\s*percent\b/i.exec(blob)?.[1];
  const program = findProgram(title);
  const who = companies[0] || findActor(title);
  const up = /rais|bigger|increase|boost|up from|higher/i.test(blob);

  if ((type === "Policy & budget" || lead.id === "policy") && (pct || money) && (program || who)) {
    const subject = program || "this account";
    const mark = pct && money ? `${pct}% ${up ? "higher" : "revised"}, to ${money}` : pct ? `${pct}% ${up ? "higher" : "revised"}` : money!;
    return `${who || "Appropriators"} set ${subject} ${mark}. The number that matters is what survives conference, not the request.`;
  }
  const onTopic = /\b(?:on|over)\s+([^,.]{8,80})/i.exec(title)?.[1]?.trim();
  if ((type === "Policy & budget" || lead.id === "policy") && who && onTopic) {
    return `${who} is pressing on ${onTopic}. Until a figure is in the bill, this is oversight, not a budget.`;
  }
  if (/green light to buy|foreign military sale|cleared to buy/i.test(title) && (program || money)) {
    return `${who || "The buyer"} got export approval${program ? ` for ${program}` : ""}${money ? ` (${money})` : ""}. This is a government sale, not a merger — watch whether the munitions are in the package.`;
  }
  if (type === "Contract" && (money || program) && (who || program)) {
    const seller = who || program;
    const what = program && who ? ` for ${program}` : "";
    return `${seller} ${money ? `books ${money}` : "books a contract"}${what}. Count it as demand, and watch whether the next order is a follow-on or a one-off.`;
  }
  if (lead.id === "cuas" && /laser|microwave|directed energy|counter-?drone|interceptor drone/i.test(blob)) {
    const weapon = program || (/laser/i.test(blob) ? "laser" : "counter-drone system");
    return `${who ? `${who} showed ${weapon}` : weapon} can make the shot. It counts when a service pays to field it, not when the demo works.`;
  }
  if (type === "Funding" && who && money) {
    return `${who} raised ${money}. The test is whether that money becomes a program of record before the next round.`;
  }
  if (type === "M&A & IPO" && who) {
    return `${who}${money ? ` (${money})` : ""} is consolidation${program ? ` around ${program}` : ""}. Watch what the buyer keeps and what gets sold off.`;
  }
  if (lead.id === "strike" && program && !money) {
    return who
      ? `${who} showing up with ${program} is a sighting, not an order. Watch who buys the next batch.`
      : `${program} is a sighting or a test, not an order. Watch who buys the next batch.`;
  }
  if (who && program && program.toLowerCase() !== who.toLowerCase()) {
    return `${who} just put ${program} in play${money ? ` (${money})` : ""}. Treat the announcement as intent until a contract or an appropriation follows.`;
  }
  const object = title.match(/\baccess to\s+((?:most |the )?[A-Za-z][^.]{6,70})$/i)?.[1]?.trim();
  if (who && object && object.toLowerCase() !== who.toLowerCase()) {
    const thing = object.replace(/^(?:most |advanced |new )+/i, "").trim();
    return `${who} just put ${thing} in front of a buyer. Treat it as intent until a contract or an appropriation follows.`;
  }
  if (program && (money || pct)) {
    return `${program} at ${money || `${pct}%`} is the tell. Track whether the money is appropriated, not just briefed.`;
  }
  return "";
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
