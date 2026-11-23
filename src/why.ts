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
  if (s && !/[.!?]$/.test(s)) s += ".";
  return s;
}

const WATCH: Record<string, string> = {
  air: "which airframe or weapon gets a production order after the demo",
  sea: "port force-protection and counter-USV sensing",
  cuas: "a counter-drone shot cheap enough to issue to every unit",
  strike: "who can deliver the munition in volume",
  missiledef: "which interceptor and which sensor get the production buy",
  global: "which ally actually places the order",
  policy: "whether the memo turns into a restriction on contracts",
  adversary: "what the other side fields next, because that sets the requirement",
  space: "which orbit and which bus get the next order",
  cyber: "who gets the defensive contract after the intrusion",
  ew: "which jammer or sensor gets onto the ship",
  ai: "whether the software becomes the system of record",
  primes: "where the prime subcontracts instead of building it",
  mfg: "which factory can actually raise output",
  capital: "whether the round turns into a program of record",
};

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

function namedThing(title: string, body: string): string | undefined {
  const text = `${title} ${body}`;
  const hit = text.match(/\b(Mirage 2000|Nightmare FPV|Fort Bragg|Fort Benning|Benghazi|Libya|Canada|Stinger|SEWIP|THAAD|F-35|DropShip|Pyka|corvette)\b/i);
  return hit?.[1];
}

function sectorLine(sector: string | undefined, title: string, body: string): string {
  const thing = namedThing(title, body);
  const watch = WATCH[sector || ""] || "whether a buyer funds a follow-on";
  return cleanCopy(`${thing ? `${thing} changes what gets bought. ` : ""}The watch item is ${watch}.`);
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

/**
 * Consequence for a buyer or builder. Never the lede, and never a near-copy of it.
 * `lead` is only used for the sector watch fallback.
 */
export function storyWhy(title: string, body: string, lead?: { id?: string }, _type?: string, _companies: string[] = []): string {
  const what = cleanCopy(body || title);
  const specific = patternLine(title, body);
  const fallback = sectorLine(lead?.id, title, body);
  const line = specific && tokenOverlap(specific, what) <= 0.6 ? specific : fallback;
  const out = cleanCopy(line);
  if (out && tokenOverlap(out, what) <= 0.6) return out;
  return cleanCopy(`The watch item is ${WATCH[lead?.id || ""] || "whether a buyer funds a follow-on"}.`);
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
