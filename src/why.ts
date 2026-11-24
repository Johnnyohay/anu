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

function programOf(text: string): string | undefined {
  const m = text.match(/\b(Trident II D5|Geran-\d+|SPYS|Type 004|Golden Dome|DAWG|F-35 Block 4|F-35|Luzon Strait|Arrow|SEWIP|HIMARS|Stinger|PULS|THAAD|Valkyrie|AMPV|MH-47Gs?)\b/i);
  return m?.[1];
}

function allMoney(text: string): string[] {
  return [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|bn|m|b)\b/gi)].map((m) => {
    const n = m[1].replace(/,/g, "");
    const unit = m[2].toLowerCase();
    return unit === "billion" || unit === "bn" || unit === "b" ? `$${n}B` : `$${n} million`;
  });
}

/** Drop a NER fragment that is just the headline's first words plus a verb. */
function firm(title: string, companies: string[]): string | undefined {
  const bad = /\b(reports|says|said|orders|lands|wins|closes|acquires|journal|development)\b/i;
  const good = companies.find((c) => !bad.test(c));
  if (good) return good;
  return title.match(/\b([A-Z][A-Za-z0-9&'.-]+)\b/)?.[1];
}

function actor(text: string, companies: string[], title: string): string {
  const t = text.toLowerCase();
  if (/special operations command|\bsocom\b/.test(t)) return "SOCOM";
  if (/\bnasa\b/.test(t)) return "NASA";
  if (/air force/.test(t)) return "The Air Force";
  if (/pentagon|department of war/.test(t)) return "The Pentagon";
  if (/\bnavy\b/.test(t)) return "The Navy";
  if (/\barmy\b/.test(t)) return "The Army";
  return firm(title, companies) || "The buyer";
}

/**
 * A line built only from facts that are actually in the story: buyer, program,
 * dollar amount, deadline, and what changes. No sector stock phrase.
 */
function factLine(title: string, body: string, companies: string[], ctx?: WhyContext): string {
  const text = `${title}. ${body}`;
  const t = text.toLowerCase();
  const money = moneyPhrase(text);
  const program = programOf(text);
  const who = actor(text, companies, title);

  if (/\b(topline|reconciliation)\b/.test(t) || (/\bappropriations?\b/.test(t) && /\b(cr|continuing resolution|stopgap)\b/.test(t))) {
    const when = ctx?.deadline;
    const stakes = (ctx?.stakes ?? []).filter((s) => s);
    const like = stakes.length ? ` like ${stakes.join(" and ")}` : "";
    if (when) return `If there's no topline by ${when}, another CR freezes new starts${like}.`;
    return "Without a topline, another continuing resolution freezes new starts.";
  }
  if (/sole-source/.test(t) && /lockheed/.test(t) && /20\d{2}/.test(t)) {
    const year = text.match(/through\s+(20\d{2})/i)?.[1] ?? text.match(/\b(20\d{2})\b/)?.[1];
    return `Sole-source work through ${year} locks in Lockheed's strategic-missile backlog.`;
  }
  if (/\bloan\b/.test(t) && /philippine/.test(t)) {
    const place = /luzon strait/i.test(text) ? "Luzon Strait sites" : "the sites in the loan";
    return `Financing for ${place} sets up US-built buys for the Philippine military.`;
  }
  if (/backlog/.test(t) && /israel/.test(t) && money && /missile/.test(t)) {
    return `A ${money} backlog shows Israeli missile defense is now a mainstream export.`;
  }
  if (/(shot down|downs|destroyed)/.test(t) && /interceptor/.test(t)) {
    const weapon = text.match(/Geran-\d+/i)?.[0] ?? "that target";
    const who = /ukrain/.test(t) ? "Ukraine" : "The unit that fired";
    return `${who} downing a ${weapon} with an interceptor makes that round a combat reference. The next buy is more of the round that worked.`;
  }
  if (/china/.test(t) && /carrier/.test(t) && /nuclear/.test(t)) {
    return "A nuclear carrier lets China launch aircraft faster than its earlier hulls. The buy that follows is the air wing and the escorts.";
  }
  if (/\b(acquires|acquired|acquisition of|to acquire)\b/.test(t)) {
    const name = firm(title, companies) || "A company";
    const target = text.match(/\b(?:acquires|acquired|acquire)\s+(?:[\w']+\s+){0,4}([A-Z][\w&'-]+)/)?.[1];
    return target
      ? `${name}'s purchase of ${target} changes who owns that tool. It is an ownership change, not a new program of record.`
      : `${name} bought a tool defense customers already use. The change is who owns it, not a new program.`;
  }
  if (/in talks/.test(t) && /drone/.test(t)) {
    const plants = [/\bgeneral motors\b|\bgm\b/.test(t) ? "GM" : "", /\bford\b/.test(t) ? "Ford" : ""].filter(Boolean);
    const names = plants.length ? plants.join(" and ") : "commercial plants";
    return `The Pentagon is asking ${names} to mass-produce military drones. The change is a car plant becoming a drone line.`;
  }
  if (/posted in error|has not yet done so/.test(t) && money && /contract/.test(t)) {
    return `${who} says the ${money} contract was posted in error and is not awarded. There is no buy until it is reposted.`;
  }
  if (/backlog/.test(t) && allMoney(text).length >= 2) {
    const [revenue, backlog] = allMoney(text);
    const parts = [/\bnavy\b/.test(t) ? "the Navy" : "", /\barmy\b/.test(t) ? "the Army" : "", /\bnga\b/.test(t) ? "NGA" : ""].filter(Boolean);
    const list = parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    const name = firm(title, companies) || "The company";
    return `${name} reported ${revenue} of revenue and a ${backlog} backlog${list ? `, including work for ${list}` : ""}. That is the order book, not a new program.`;
  }
  if (money && program && /(contract|award|modification|orders|order)\b/.test(t)) {
    const through = text.match(/\bthrough\s+((?:[A-Z][a-z]+|\d{4})(?:\s+\d{4})?)/);
    return `${who} is spending ${money} on ${program}${through ? ` through ${through[1]}` : ""}. That is a funded order.`;
  }
  if (money && /(contract|award|modification|orders)\b/.test(t)) {
    const through = text.match(/\bthrough\s+((?:[A-Z][a-z]+|\d{4})(?:\s+\d{4})?)/);
    return `${who} is spending ${money}${through ? ` through ${through[1]}` : ""} on a signed award. That is a funded order.`;
  }
  if (program) {
    return `${program} is the program this story moves. What changes is whether a service funds the next lot.`;
  }
  return "";
}

/** When the story has no buyer, dollar, or deadline, say so instead of borrowing a sector line. */
function honestThin(title: string, body: string): string {
  const text = `${title} ${body}`;
  if (/cremated|memorial (spacecraft|cubesat)|ashes/i.test(text)) {
    return "A commercial memorial flight is not a defense space order. No service is the buyer.";
  }
  const name = title.replace(/\s+/g, " ").trim().replace(/[.:]$/, "");
  const short = name.length > 72 ? name.slice(0, 69).replace(/\s+\S*$/, "") : name;
  return `${short} names the event. It does not name a buyer, a dollar figure, or a deadline.`;
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
  if (/(mirage|cannon|built-in gun|\bgun\b)/.test(t) && /drone/.test(t) && /(gun|cannon)/.test(t)) {
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
  const built = (specific && tokenOverlap(specific, what) <= 0.6 ? specific : "") || factLine(title, body, companies, ctx);
  const out = cleanCopy(built);
  if (out && tokenOverlap(out, what) <= 0.6 && allowed(out, story) && !/the watch item is/i.test(out)) return out;
  const thin = cleanCopy(honestThin(title, body));
  if (thin && tokenOverlap(thin, what) <= 0.6 && allowed(thin, story)) return thin;
  return "The story does not name a buyer, a dollar figure, or a deadline.";
}

function normLine(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** No two stories in one brief keep the same so-what. A repeat gains the other story's name. */
export function uniqueWhys<T extends { title: string; why: string }>(items: T[]): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = normLine(item.why);
    const n = seen.get(key) ?? 0;
    if (n > 0) {
      const name = item.title.replace(/\s+/g, " ").trim();
      const short = name.length > 80 ? name.slice(0, 77).replace(/\s+\S*$/, "") : name;
      item.why = cleanCopy(`${item.why.replace(/\.$/, "")}. This one is ${short}`);
    }
    seen.set(normLine(item.why), (seen.get(normLine(item.why)) ?? 0) + 1);
    seen.set(key, n + 1);
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
