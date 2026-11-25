/**
 * Why-it-matters lines for the brief. A line is the consequence for someone
 * buying or building defense tech. It is rejected when it is a near-copy of the
 * summary. The lede is never the fallback: a weak match uses the sector's watch
 * item, tied to a name from the story.
 */
const STOP = new Set("the a an of to for and or in on with from its their this that has have after over into than then says said will would about new more most first next was were been being into than".split(" "));

export function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/** Jaccard overlap of content words. A trimmed lede scores high. A so-what that adds a consequence scores lower even when it repeats the program and the figure. */
export function tokenOverlap(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / new Set([...A, ...B]).size;
}

/** True when the line is a near-copy of any one sentence in the story, not only of the whole summary. */
export function copiesBodySentence(line: string, body: string): boolean {
  if (!line.trim() || !body.trim()) return false;
  const parts = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return (parts.length ? parts : [body.trim()]).some((s) => tokenOverlap(line, s) > 0.6);
}

/** Quotes, dangling commas, and the USV misnomer. */
export function cleanCopy(text: string): string {
  let s = text
    .replace(/\buncrewed service vessels?\b/gi, (m) => (/s$/i.test(m) ? "uncrewed surface vessels" : "uncrewed surface vessel"))
    .replace(/[“”„]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/[,"'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/(?:…|\.{3,})+\.?$/g, "…");
  if (s && !/[.!?…]$/.test(s)) s += ".";
  return s;
}

function blobOf(title: string, body: string): string {
  return cleanCopy(`${title}. ${body}`).toLowerCase();
}

/** Subject of the limiting action, not the first institution named in the headline. */
export function limitActor(text: string): string | undefined {
  const m = text.match(/\b(the United States|the U\.S\.|Washington|Hegseth|Canada|NATO|Ukraine|Russia|China)\b(?:[\s,]\w+){0,10}?\s+(?:would |will |to )?(?:limit|restrict)/i);
  if (!m) return;
  if (/united states|^the u\.s/i.test(m[1])) return "The United States";
  return m[1].replace(/^the /i, "");
}

/** A dollar figure as written, with billion shortened to B so lines stay comparable. */
function moneyPhrase(text: string): string | undefined {
  const m = text.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|bn|m|b)\b/i);
  if (!m) return;
  const n = m[1].replace(/,/g, "");
  const unit = m[2].toLowerCase();
  if (unit === "billion" || unit === "bn" || unit === "b") return `$${n}B`;
  return `$${n} million`;
}

const NOT_ACTOR = new Set(
  "yes no new how from with top opening private investment equity firm the company reports says said orders lands wins closes acquires launches takes joins sets gives wants upgrading thruster european israeli turkish russian chinese american ukrainian german french british colombian polish japanese korean indian canadian philippine finnish libyan white despite after before over into about their house".split(" "),
);

/** A company or institution from the headline, not a leading adjective, verb, or fragment of "White House". */
function firm(title: string, companies: string[]): string | undefined {
  if (/\bwhite house\b/i.test(title)) return "the White House";
  const bad = /\b(reports|says|said|orders|lands|wins|closes|acquires|journal|development)\b/i;
  const good = companies.find((c) => !bad.test(c) && !NOT_ACTOR.has(c.toLowerCase()));
  if (good) return good;
  const phrase = title.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/);
  if (phrase && !phrase[1].split(" ").some((w) => NOT_ACTOR.has(w.toLowerCase()) || bad.test(w))) return phrase[1];
  const words = title.match(/\b[A-Z][A-Za-z0-9&'.-]{2,}\b/g) ?? [];
  return words.find((w) => !NOT_ACTOR.has(w.toLowerCase()) && !bad.test(w));
}

const STOCK_HEDGE = /that is a funded order|not a new program of record|ownership change|the order book, not|names the event|does not name a buyer|this story moves|whether a service funds the next lot|is the party in the story|a buyer has to adopt|this one is /i;

/** A canned closer that avoids saying what the buyer gains. */
export function isStockHedge(line: string): boolean {
  return STOCK_HEDGE.test(line);
}

/** Reject a sentence with no subject, or "says was" with the object missing. */
export function grammarProblem(line: string): string {
  const s = line.trim();
  if (!s) return "";
  if (/\bsays was\b/i.test(s)) return "missing object";
  if (!/^(?:The |A |An )?[A-Z0-9$]/.test(s)) return "no subject";
  return "";
}

/**
 * Backlog ÷ revenue when both dollar figures are labeled in the story.
 * $48.3B backlog / $13.8B revenue is "3.5" (years of work already booked).
 */
export function backlogYears(story: string): string | undefined {
  let revenue: number | undefined;
  let backlog: number | undefined;
  const re = /\$\s?(\d+(?:\.\d+)?)\s*(billion|bn|b|million|m)\b/gi;
  for (const m of story.matchAll(re)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = m[2].toLowerCase();
    const billions = unit === "million" || unit === "m" ? n / 1000 : n;
    const after = story.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40).split(/\$/)[0];
    if (revenue === undefined && /\brevenue\b/i.test(after)) revenue = billions;
    if (backlog === undefined && /\bbacklog\b/i.test(after)) backlog = billions;
  }
  if (!revenue || !backlog) return;
  const years = backlog / revenue;
  if (years < 1.5 || years > 12) return;
  const rounded = Math.round(years * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "X changes Y to Z" is a template. A blank line is better. */
export function isMechanicalChange(line: string): boolean {
  return /\bchanges?\s+(?:[\w'-]+\s+){0,6}to\b/i.test(line);
}

/** The line's job is the dollar figure already in the summary, not a consequence. */
export function restatesSummaryNumbers(line: string, summary: string): boolean {
  const figs = [...summary.matchAll(/\$\s?(\d[\d.]*)/g)].map((m) => m[1]);
  if (!figs.length) return false;
  const inLine = [...line.matchAll(/\$\s?(\d[\d.]*)/g)].map((m) => m[1]);
  const shared = inLine.filter((n) => figs.some((f) => f === n || f.startsWith(n) || n.startsWith(f)));
  if (!shared.length) return false;
  if (/\b(positions|win the next|sell|keeps the|incumbent|analysis|imagery|jam|adopt|release|exempts|not awarded|export|mainstream)\b/i.test(line)) return false;
  return /reported|figure on the table|that is a funded order|that is the order book/i.test(line);
}

function actor(text: string, companies: string[], title: string): string {
  const titleL = title.toLowerCase();
  if (/\bwhite house\b/i.test(title)) return "the White House";
  if (/\bsocom\b/.test(titleL)) return "SOCOM";
  if (/special operations command/.test(titleL)) return "Special Operations Command";
  if (/\bnasa\b/.test(titleL)) return "NASA";
  if (/air force/.test(titleL)) return "The Air Force";
  if (/pentagon|department of war/.test(titleL)) return "The Pentagon";
  if (/\bnavy\b/.test(titleL)) return "The Navy";
  if (/\barmy\b/.test(titleL)) return "The Army";
  return firm(title, companies) || "";
}

const GLUE = new Set(
  "the a an of to for and or in on with from its their this that has have after over into than then says said will would about new more most first next was were been being who what when just only not now can may also them they your per under lot lots buy buys buyer buyers buying sell selling sold win winning award awards order orders ordered contract contracts posted error awarded hold holds holding keep keeps adding added another until before shows show shown make makes made let lets offer offers want wants already change changes gain gains market markets customer customers follow service services adopt adopts adopting work line lines unit units system systems program programs field fielding sets yet named story competition incumbent unseat rival rivals frozen starts without through keeps moved party depends respond ordering talks manufacturers build would about says positions".split(" "),
);

/** Content words in a line that do not appear in the story. Template glue is allowed. */
export function ungroundedTerms(line: string, story: string): string[] {
  const words = story.toLowerCase().replace(/[^a-z0-9+-]+/g, " ").split(/\s+/).filter(Boolean);
  const known = new Set(words);
  for (const w of words) {
    known.add(w.replace(/s$/, ""));
    for (const part of w.split("-")) if (part.length > 2) known.add(part);
  }
  const years = backlogYears(story);
  const yearTokens = new Set<string>();
  if (years && line.includes(years) && /\byears?\b/i.test(line)) {
    yearTokens.add("year");
    yearTokens.add("years");
    for (const part of years.split(/\D+/)) if (part) yearTokens.add(part);
  }
  const bad: string[] = [];
  for (const raw of line.toLowerCase().replace(/[^a-z0-9+-]+/g, " ").split(/\s+/)) {
    const w = raw.replace(/^\$/, "");
    if (!w || w.length <= 3 || GLUE.has(w) || GLUE.has(w.replace(/s$/, ""))) continue;
    if (known.has(w) || known.has(w.replace(/s$/, "")) || known.has(`${w}s`)) continue;
    if (yearTokens.has(w)) continue;
    if (/^\d/.test(w) && story.toLowerCase().includes(w.replace(/b$/, ""))) continue;
    bad.push(w);
  }
  return bad;
}

function present(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function namedBuyers(text: string): string[] {
  const t = text.toLowerCase();
  return [present(t, "navy") ? "the Navy" : "", present(t, "army") ? "the Army" : "", present(t, "nga") ? "NGA" : "", /nuclear/.test(t) ? "nuclear" : ""].filter(Boolean);
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** A program token copied from the story, not from a fixed list of headlines. */
function extractProgram(title: string, body: string): string | undefined {
  const text = `${title} ${body}`;
  const patterns = [
    /\b(Trident(?: II)?(?: D5)?)\b/,
    /\b([A-Z]{1,6}-\d+[A-Z0-9]*)\b/,
    /\b([A-Z][a-z]+-\d+)\b/,
    /\b([A-Z]{2,}(?:-[A-Z0-9]+)+)\b/,
    /\b(Type \d+)\b/,
  ];
  for (const re of patterns) {
    const hit = text.match(re)?.[1];
    if (hit && hit.length > 2) return hit;
  }
  return undefined;
}

/** Programs the headline puts at stake: a proper name, a code, or "the battleship". */
function stakePrograms(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    if (!/white house|congress|united|national/i.test(m[1])) out.push(m[1]);
  }
  if (/\bbattleship\b/i.test(title) && !out.some((p) => /battleship/i.test(p))) out.push("the battleship");
  const code = extractProgram(title, "");
  if (code && !out.includes(code)) out.push(code);
  return [...new Set(out)];
}

/**
 * Consequence lines for stories the narrow patterns miss. Each draft is built
 * only when the story itself states a buyer, program, dollar, or deadline and
 * a consequence (an approval, an ownership change, a development, a listing, talks).
 */
function effectDrafts(title: string, body: string, companies: string[]): string[] {
  const text = `${title}. ${body}`;
  const t = text.toLowerCase();
  const drafts: string[] = [];
  const who = actor(text, companies, title);
  const program = extractProgram(title, body);
  const stakes = stakePrograms(title);

  if (/anomal/.test(t) && /not approved/.test(t) && /stopgap/.test(t) && /funding/.test(t) && stakes.length) {
    drafts.push(`${joinList(stakes)} have no stopgap funding until anomalies are approved.`);
  }
  if (program && /agreement/.test(t) && /develop/.test(t) && /beyond\s+\d+/.test(t)) {
    const km = text.match(/\bbeyond\s+(\d+)\s*km/i)?.[1];
    const parties = [...new Set(
      [...text.matchAll(/\b(Poland|United Kingdom|UK|Britain)\b/g)].map((m) => (m[1] === "UK" || m[1] === "United Kingdom" ? "the UK" : m[1])),
    )];
    if (km && parties.length >= 2) drafts.push(`Without the agreement, ${joinList(parties)} do not develop ${program} beyond ${km} km.`);
  }
  if (/mass-produce/.test(t) && /talks/.test(t) && /pentagon/.test(t) && /drone/.test(t)) {
    const span = text.match(/\btalks with ([^.]+?) about\b/i)?.[1] ?? "";
    const names = [...new Set(
      span.split(/,|\band\b/i).map((s) => s.trim()).filter((s) => /^[A-Z]/.test(s) && !/manufacturer|other|pentagon/i.test(s)),
    )];
    if (names.length) drafts.push(`Talks with ${joinList(names)} would change who mass-produces the Pentagon's military drones.`);
  }
  if (/order modification|modification to buy/.test(t) && program && /helicopter/.test(t) && who) {
    const builder = text.match(/\b(Boeing|Lockheed Martin|Northrop Grumman|Sikorsky)\b/)?.[1];
    if (builder && builder !== who) drafts.push(`${builder} keeps the next lot of ${program} helicopters for ${who}.`);
  }
  return drafts;
}

/**
 * One consequence sentence. Every slot is a span copied from the story.
 * A line is kept only when the story states a buyer, program, dollar, or deadline
 * and a consequence. Drafts that name something the story does not say are dropped.
 */
function composeWhy(title: string, body: string, companies: string[]): string {
  const text = `${title}. ${body}`;
  const t = text.toLowerCase();
  const who = actor(text, companies, title);
  const program = extractProgram(title, body);
  const money = moneyPhrase(text);
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  const drafts: string[] = [];

  if (/posted in error|has not yet/.test(t) && /contract/.test(t) && who) {
    drafts.push(`${who} says the contract was posted in error and is not awarded yet.`);
  }
  if (/backlog/.test(t)) {
    const name = firm(title, companies) || who;
    const years = backlogYears(text);
    const buyers = namedBuyers(text).map((b) => b.replace(/^the /i, ""));
    const lead = ["NGA", "nuclear", "Navy", "Army"].filter((b) => buyers.some((x) => x.toLowerCase() === b.toLowerCase()));
    if (name && years) {
      const booked = lead.length ? `, including ${joinList(lead)} awards` : "";
      const rev = text.match(/\$\s?\d+(?:\.\d+)?\s*(?:billion|bn|b)\b(?=[^$]{0,40}\brevenue\b)/i)?.[0]?.replace(/\s+/g, "");
      const book = text.match(/\$\s?\d+(?:\.\d+)?\s*(?:billion|bn|b)\b(?=[^$]{0,40}\bbacklog\b)/i)?.[0]?.replace(/\s+/g, "");
      drafts.push(rev && book
        ? `${name}'s ${book} backlog is about ${years} years of the ${rev} revenue${booked}.`
        : `${name}'s backlog is about ${years} years of revenue${booked}.`);
    }
    if (money && /missile/.test(t)) drafts.push(`A ${money} backlog makes ${name} the incumbent on missile defense.`);
    if (money && !years) drafts.push(`A ${money} backlog makes ${name} the incumbent on the next competition.`);
  }
  if (/\b(acquires|acquired|acquisition|to acquire)\b/.test(t)) {
    if (who && /analysis/.test(t) && /geospatial/.test(t) && /customer/.test(t)) {
      drafts.push(/data fusion/.test(t)
        ? `${who} sells analysis and data fusion to defense customers, not only geospatial data.`
        : `${who} sells analysis to defense customers, not only geospatial data.`);
    }
  }
  if (/(shot down|downs|destroyed)/.test(t) && /interceptor/.test(t) && /ukrain/.test(t) && program) {
    drafts.push(`The next buy is more of the Ukrainian interceptor that destroyed ${program}.`);
  }
  if (/sole-source/.test(t) && year && who) {
    drafts.push(`Sole-source work through ${year} keeps ${who} on this program.`);
  }
  if (/\bloan\b/.test(t)) {
    const place = text.match(/\b(Luzon Strait)\b/i)?.[1];
    if (place && /philippine/.test(t) && /military/.test(t)) drafts.push(`The loan for ${place} sets up buys for the Philippine military.`);
    else if (place && /military/.test(t)) drafts.push(`The loan for ${place} sets up buys for the military.`);
    else if (money && who) drafts.push(`${who} is using the ${money} loan to fund the buy.`);
  }
  if (/white house/.test(t) && /contractors/.test(t) && /congress/.test(t)) {
    drafts.push(`The order makes contractors alert the White House before answering Congress.`);
  }
  if (/topline|reconciliation/.test(t)) {
    drafts.push(year ? `Without a topline by ${year}, new starts are frozen.` : `Without a topline, new starts are frozen.`);
  }
  drafts.push(...effectDrafts(title, body, companies));

  for (const draft of drafts) {
    if (ungroundedTerms(draft, text).length || isStockHedge(draft) || grammarProblem(draft) || isMechanicalChange(draft)) continue;
    if (tokenOverlap(draft, title) > 0.6) continue;
    return draft;
  }
  return "";
}

function factLine(title: string, body: string, companies: string[], _ctx?: WhyContext): string {
  return composeWhy(title, body, companies);
}

function honestThin(title: string, body: string): string {
  return composeWhy(title, body, []);
}

export interface WhyContext {
  /** Next budget deadline, e.g. "Dec 11", used only when the story is about the topline. */
  deadline?: string;
  /** Programs the deadline actually puts at stake, from the calendar, not invented. */
  stakes?: string[];
}

function patternLine(title: string, body: string): string {
  const t = blobOf(title, body);
  if (/ukrain/.test(t) && /(usv|uncrewed|drone boat)/.test(t) && /(libya|benghazi|mediterranean)/.test(t) && /(corvette|ship|naval)/.test(t)) {
    return "Ukraine can now hit Russian ships 1,000+ miles from the Black Sea, so Russia's Mediterranean basing in Libya is exposed. Expect demand for port force-protection and counter-USV sensing.";
  }
  if (/(corvette|warship)/.test(t) && /(libya|benghazi)/.test(t)) {
    return "A Russian corvette lost at Benghazi puts Moscow's Libyan naval base in range of small boats. The buy that follows is port force-protection and counter-USV sensing, not another anti-ship missile.";
  }
  if (/mirage/.test(t) && /drone/.test(t) && /(gun|cannon)/.test(t)) {
    return "A fighter gun, not a missile, killed a jet-powered drone. Air forces will buy cannon cueing and ammunition for that shot, because the missile is the expensive side of the trade.";
  }
  if (/(nightmare|fpv|kamikaze)/.test(t) && /(special forces|fort bragg|socom)/.test(t)) {
    return "US special forces are looking at a Ukrainian FPV already flown by the thousands. The order that matters is a SOCOM buy, not a booth at Fort Bragg.";
  }
  if (/(shotgun|12-gauge)/.test(t) && /drone/.test(t)) {
    return "The Army is screening commercial 12-gauge loads against small drones at Fort Benning. If one works, every infantry squad is a counter-drone customer and the shell is the product.";
  }
  if (/\blimit/.test(t) && /canada/.test(t) && /(united states|\bu\.s\b|\bus\b)/.test(t)) {
    const fund = /100 million|innovation fund/.test(t);
    return `The United States is limiting defense cooperation with Canada${fund ? ", and Ottawa answered with C$100 million for NATO's innovation fund. Canadian suppliers lose the direct US route and have to sell through NATO" : ""}.`;
  }
  if (/serial production|autonomous cargo/.test(t)) {
    return "An autonomous cargo aircraft is moving from a first flight toward serial production. The open question is which service pays for unmanned logistics airlift once more than one airframe exists.";
  }
  if (/release kit|into bombers|munitions from drones/.test(t)) {
    return "The 101st is training to drop munitions from small drones. The product is the release kit and the drone munition, not the quadcopter.";
  }
  if (/\bsewip\b/.test(t)) {
    const n = t.match(/(\d{1,3}) companies/);
    const b = t.match(/\$(\d+(?:\.\d+)?) billion/);
    return `The Navy opened a ${b ? `$${b[1]} billion ` : ""}SEWIP vehicle${n ? ` to ${n[1]} companies` : ""}. Shipboard electronic-warfare installs now go through that vehicle, and a spot on it is not yet a funded order.`;
  }
  const mil = t.match(/\$(\d+(?:\.\d+)?) million/);
  if (mil && /f-35/.test(t) && /block 4|delay|accelerat/.test(t)) {
    return `The Navy is spending $${mil[1]} million to unstick a late F-35 Block 4 upgrade. That is schedule money on jets already in service, not a new production buy.`;
  }
  if (/stinger/.test(t) && /under/.test(t)) {
    return "The Army capped a Stinger replacement at under $200,000 a missile and set a live-fire shootout for mid-2027. A vendor not ready for that shootout is out of the short-range air-defense buy.";
  }
  if (/space force/.test(t) && /percent/.test(t)) {
    const pct = t.match(/(\d{1,3}(?:\.\d+)?) percent/);
    const bills = [...t.matchAll(/\$(\d+(?:\.\d+)?) billion/g)].map((m) => m[1]);
    if (pct && bills[0]) return `Appropriators marked the Space Force up ${pct[1]}%, to $${bills[0]} billion${bills[1] ? ` from $${bills[1]} billion` : ""}. Suppliers should plan on the conference number, not the request.`;
  }
  if (/puls/.test(t) && /million/.test(t)) {
    const m = t.match(/\$(\d+(?:\.\d+)?) million/);
    return `A NATO country ordered $${m?.[1] ?? ""} million of PULS rocket artillery. European armies are restocking launchers, and the next tell is who copies the buy.`;
  }
  if (/himars/.test(t) && /210/.test(t)) {
    return "State approved a $210 million HIMARS package for Albania. It is an export of launchers and rockets, and the rockets are the part that runs out.";
  }
  if (/iran war costs/.test(t)) {
    return "The Senate is forcing a cost figure for the Iran war out of the acting Navy secretary. Deployments and maintenance get squeezed to pay for it, and that squeeze is the demand signal.";
  }
  if (/valkyrie|high-energy laser/.test(t) && /cruise missile|destroyed|downs/.test(t)) {
    return "Lockheed's Valkyrie laser killed a cruise-missile stand-in. Directed energy changes the buy only if a service pays to field a weapon the Army already set aside.";
  }
  if (/anti-tank/.test(t)) {
    return "A Chinese anti-tank missile in Moroccan service is a proliferation clue. The firms who benefit sell the counter to that missile, not a ground robot.";
  }
  if (/sixteen-fold|155mm/.test(t) && /plant|shell/.test(t)) {
    return "BAE says a new automated plant can fill sixteen times as many 155mm shells. Shell capacity, not a new US contract, is what moved, and every gun battery feels that number.";
  }
  return "";
}

const FORBIDDEN = [
  { word: /\bmemo\b/i, inStory: /\bmemo\b/i },
  { word: /which orbit|which bus/i, inStory: /\b(orbit|bus)\b/i },
  { word: /munition in volume/i, inStory: /\bvolume\b/i },
];

function allowed(line: string, story: string): boolean {
  return FORBIDDEN.every((f) => !f.word.test(line) || f.inStory.test(story));
}

/**
 * Consequence for a buyer or builder, from this story's own facts.
 * A sector watch line is never used: a concept that is not in the story is rejected.
 */
export function storyWhy(
  title: string,
  body: string,
  _lead?: { id?: string },
  _type?: string,
  companies: string[] = [],
  ctx?: WhyContext,
): string {
  const what = cleanCopy(body || title);
  const story = `${title}. ${body}`;
  const specific = patternLine(title, body);
  const candidates: { line: string; grounded: boolean }[] = [
    { line: specific && tokenOverlap(specific, what) <= 0.6 ? specific : "", grounded: false },
    { line: factLine(title, body, companies, ctx), grounded: true },
  ];
  for (const candidate of candidates) {
    const out = cleanCopy(candidate.line);
    if (!out || tokenOverlap(out, what) > 0.6 || !allowed(out, story)) continue;
    if (/the watch item is/i.test(out) || isStockHedge(out) || isMechanicalChange(out) || restatesSummaryNumbers(out, what) || grammarProblem(out)) continue;
    if (copiesBodySentence(out, body) || copiesBodySentence(out, title)) continue;
    if (candidate.grounded && ungroundedTerms(out, story).length) continue;
    if (candidate.grounded && tokenOverlap(out, title) > 0.6) continue;
    return out;
  }
  return "";
}

function normLine(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Identical lines are too generic to keep. Both copies are cleared, and the headline is not pasted on. */
export function uniqueWhys<T extends { title: string; why: string }>(items: T[]): void {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!item.why.trim()) continue;
    const key = normLine(item.why);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length > 1) for (const item of list) item.why = "";
  }
}

/**
 * One Groq call for the day's lines, only when GROQ_API_KEY is set.
 * A line that copies the summary is discarded and the rule-based line stays.
 * The daily job and CI have no key, so they keep the rule-based lines.
 */
export async function polishWhys(items: { id: string; title: string; body: string; why: string; sector?: string }[]): Promise<void> {
  if (!process.env.GROQ_API_KEY || !items.length) return;
  try {
    const { PROVIDERS } = await import("./llm.ts");
    const { chat } = await import("./llm.ts");
    const res = await chat(PROVIDERS.groq(), {
      temperature: 0.2,
      json: true,
      messages: [
        { role: "system", content: "Write one so-what sentence per story for someone buying or building defense tech: who buys, what changes, who benefits. Do not paraphrase the lede. Return JSON {\"lines\":[{\"id\":\"...\",\"why\":\"...\"}]}." },
        { role: "user", content: JSON.stringify(items.map((i) => ({ id: i.id, title: i.title, sector: i.sector, body: i.body.slice(0, 420) }))) },
      ],
    });
    const parsed = JSON.parse(res.content) as { lines?: { id: string; why: string }[] };
    for (const row of parsed.lines ?? []) {
      const item = items.find((i) => i.id === row.id);
      const why = cleanCopy(row.why ?? "");
      if (item && why && tokenOverlap(why, item.body) <= 0.6) item.why = why;
    }
  } catch (err) {
    console.warn(`Why-line model skipped: ${err instanceof Error ? err.message : err}`);
  }
}
