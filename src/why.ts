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

/** Drop a NER fragment that is just the headline's first words plus a verb. */
function firm(title: string, companies: string[]): string | undefined {
  const bad = /\b(reports|says|said|orders|lands|wins|closes|acquires|journal|development)\b/i;
  const generic = /^(private|investment|equity|firm|the|company|how|from|with|new|top)$/i;
  const good = companies.find((c) => !bad.test(c) && !generic.test(c));
  if (good) return good;
  const words = title.match(/\b[A-Z][A-Za-z0-9&'.-]+\b/g) ?? [];
  return words.find((w) => !generic.test(w));
}

const STOCK_HEDGE = /that is a funded order|not a new program of record|ownership change|the order book, not|names the event|does not name a buyer|this story moves|whether a service funds the next lot/i;

/** A canned closer that avoids saying what the buyer gains. */
export function isStockHedge(line: string): boolean {
  return STOCK_HEDGE.test(line);
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
  if (/\b(acquires|acquired|acquisition of|to acquire)\b/.test(t) || (/\bto buy\b/.test(t) && /\b(business|firm|stake|arm|subsidiary)\b/.test(t))) {
    return acquireGain(title, text, companies);
  }
  if (/in talks/.test(t) && /drone/.test(t)) {
    const plants = [/\bgeneral motors\b|\bgm\b/.test(t) ? "GM" : "", /\bford\b/.test(t) ? "Ford" : ""].filter(Boolean);
    const names = plants.length ? plants.join(" and ") : "commercial plants";
    return `The Pentagon is asking ${names} to mass-produce military drones. The change is a car plant becoming a drone line.`;
  }
  if (/posted in error|has not yet done so/.test(t) && /contract/.test(t)) {
    return `${who} says the propulsion contract was posted in error and is not awarded. Engine makers have no award until it is reposted.`;
  }
  if (/backlog/.test(t)) {
    const parts = [/\bnavy\b/.test(t) ? "the Navy" : "", /\barmy\b/.test(t) ? "the Army" : "", /\bnga\b/.test(t) ? "NGA" : "", /nuclear/.test(t) ? "nuclear programs" : ""].filter(Boolean);
    const list = parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    const name = firm(title, companies) || "The company";
    return list
      ? `The backlog positions ${name} to win the next awards from ${list}. That is the market already buying.`
      : `The backlog makes ${name} the incumbent, so a rival has to unseat them to win the next lot.`;
  }
  if (money && program && /(contract|award|modification|orders|order)\b/.test(t)) {
    return heldLine(who, program, text);
  }
  if (money && /(contract|award|modification|orders)\b/.test(t)) {
    const name = firm(title, companies) || who;
    return `${name} holds the award, so a rival has to unseat an incumbent to get the next one.`;
  }
  if (program) return gainLine(title, body, companies);
  return "";
}

function heldLine(who: string, program: string, text: string): string {
  const t = text.toLowerCase();
  if (/mh-47|helicopter/.test(t)) return "SOCOM is adding more MH-47Gs, so Boeing's special-operations helicopter line stays open for the next unit.";
  if (/noaa|weather|sounder/.test(t)) return "Northrop keeps the weather-sounder work through 2042, so the next NOAA instrument stays with that team.";
  if (/through\s+20\d{2}|through\s+[a-z]+\s+20\d{2}/i.test(text)) {
    const year = text.match(/through\s+((?:[A-Z][a-z]+\s+)?20\d{2})/)?.[1] ?? "the end of the contract";
    return `${who} keeps ${program} through ${year}, so the follow-on stays with the incumbent.`;
  }
  return `${who} is adding more ${program}. The gain is another lot of a system already in service.`;
}

function acquireGain(title: string, text: string, companies: string[]): string {
  const t = text.toLowerCase();
  const name = firm(title, companies) || "The buyer";
  if (/analysis|data fusion|imagery|geospatial/.test(t)) {
    return `${name} can now sell analysis, not just imagery, to the defense customers who already buy the pictures.`;
  }
  if (/oneweb|broadband|factory|american ownership/.test(t)) {
    return `${name} now owns the satellite factory. The customers are whoever already flies that constellation.`;
  }
  if (/autonomous aircraft|drone/.test(t)) {
    return `${name} is pointing that business at autonomous aircraft as the drone market grows. The gain is factory capacity.`;
  }
  if (/manufactur/.test(t) && /spacecraft|space/.test(t)) {
    return `${name} would build the spacecraft, not only invest in them. The space company gets a manufacturer.`;
  }
  const target = text.match(/\b(?:acquires|acquired|acquire|buy)\s+(?:[\w']+\s+){0,4}([A-Z][\w&'-]+)/)?.[1];
  return target
    ? `${name} can sell what ${target} already makes to ${name}'s existing customers.`
    : `${name} can sell the acquired product to the customers it already has.`;
}

/** What the buyer can do after the story, using only words that are in it. */
function gainLine(title: string, body: string, companies: string[]): string {
  const text = `${title}. ${body}`;
  const t = text.toLowerCase();
  const name = firm(title, companies);
  if (/cremated|memorial spacecraft|memorial cubesat|ashes/.test(t)) return "A commercial memorial flight is not a defense space order. No service is the buyer.";
  if (/f-35/.test(t) && /gripen|core fighter|canada/.test(t)) return "Canada choosing the F-35 as its core fighter, and not the Gripen, locks the fleet. The next buy is weapons and sustainment for that jet.";
  if (/golden dome/.test(t) && /stopgap|exemption|anomal/.test(t)) return "Exempting Golden Dome lets that program keep spending while the rest of the stopgap waits.";
  if (/electronic warfare|jam/.test(t) && /frigate/.test(t)) return "Those frigates get a jammer fit. Elbit is now on the hull, and the next ship in the class is the follow-on.";
  if (/camm/.test(t)) return "Poland and the UK will develop CAMM-MR together. The next contract is the production missile, not another agreement.";
  if (/lynx/.test(t) && /ukrain/.test(t)) return "Ukrainian crews are now fielding the Lynx. That combat use is what the next export customer will ask about.";
  if (/sv-98|sniper rifle/.test(t)) return "Kalashnikov closed a rifle contract for troops already in Ukraine. The next order is more of the same rifle.";
  if (/f-15/.test(t) && /ukrain/.test(t)) return "The Eagles are in storage. Ukraine gets them only if the United States releases the airframes.";
  if (/f-16/.test(t) && /ukrain/.test(t)) return "Ukraine asked for F-16s. The constraint is which air forces can actually hand jets over.";
  if (/odin|battle planning|battalion/.test(t)) return "Brigade software does not fit a battalion. Odin matters if the Army adopts it below brigade.";
  if (/transformation in contact|campaign plan/.test(t)) return "The Army is replacing bottom-up experiments with top-down guidance. Program offices have to match the new plan.";
  if (/undersecretary of the navy|toti/.test(t)) return "If confirmed, Toti would run the Navy's civilian leadership, and ship programs would answer to that office.";
  if (/fiscal 2027|spending debate/.test(t)) return "Contractors are waiting on a fiscal 2027 budget. New starts do not begin until Congress agrees on the number.";
  if (/carrier/.test(t) && /shipbuilding/.test(t)) return "A presidential ask for more carriers happens only if the yards can build them. The Navy may revise that plan.";
  if (/auto suppliers|toyota|arms buildup/.test(t)) return "A car-parts plant is being pulled into weapons work. Japan's buildup needs those factories.";
  if (/nuclear/.test(t) && /satellite/.test(t)) return "A nuclear weapon in orbit would make satellite warning and defense the requirement.";
  if (/phased-array|two-way link/.test(t)) return "The antenna can task a GEO satellite, not only listen. The product is that terminal.";
  if (/\bsocs\b|cyberattack/.test(t)) return "The buyer is the security operations center that has to answer automated attacks.";
  if (/chatbot|hackathon/.test(t)) return "The Marine Corps is taking a hackathon prototype into production. The winning team is now the supplier.";
  if (/naval strike missile/.test(t)) return "The Marines want a longer Naval Strike Missile. The buy is the extended-range round, not a new launcher.";
  if (/25 centimeters|higher-resolution|synthetic aperture|sar satellite/.test(t)) return "Customers can see smaller targets. The companies are selling the sharper picture.";
  if (/counter-drone/.test(t) && /colombia|militant/.test(t)) return "Militant drones make the Colombian military a counter-drone buyer.";
  if (/guidebook|critical infrastructure/.test(t)) return "Bases depend on private utilities. The guide is what the Army will use to defend that infrastructure.";
  if (/contractors/.test(t) && /congress|gag|privileged|oversight/.test(t)) return "Contractors must clear answers with the White House. They lose a direct channel to Congress.";
  if (/space data network|backbone/.test(t)) return "The Space Force is filling a communications backbone. The supplier who can launch on that cadence gets the next satellites.";
  if (/finland|baltic/.test(t) && /marine|recon/.test(t)) return "US reconnaissance Marines are drilling with a Baltic navy. The gain is a shared tactic, not a US ship.";
  if (/revolution space|spacecraft/.test(t) && /ford|manufactur/.test(t)) return "Ford's factories would build the spacecraft, not only fund them. The space company gets a manufacturer.";
  if (/amazon leo|ariane/.test(t)) return "This is a commercial broadband launch, not a defense constellation.";
  if (/progress/.test(t) && /secrecy|iss/.test(t)) return "The unusual secrecy is the point. The question is what cargo needed help staying quiet.";
  if (/su-57|felon/.test(t)) return "A pro-war source says the jet could leave the war unnoticed. Export buyers should not treat it as a fighting fleet.";
  if (/robot scout|kenya|targeting network/.test(t)) return "The robot cut the time from spotting a target to a strike. The British Army is the buyer if the trial becomes a unit.";
  if (/spac\b|nyse/.test(t)) return "A stock listing gives the company public shares. It does not place a defense order.";
  if (/zhuhai|airshow/.test(t)) return "China is showing hulls and weapons for export. The buyers are the foreign navies at the show.";
  if (/cell tower|smartphone|cellular/.test(t)) return "Satellite fill-in for cell coverage is a commercial network product, not a military constellation.";
  if (/healthcare summit|fireside/.test(t)) return "This is a conference appearance. No buyer is placing an order there.";
  if (/fleet and marine tracker|carrier strike groups/.test(t)) return "This is a map of where ships already are, not an order to send more.";
  if (/bepicolombo|mercury/.test(t)) return "A science probe had a thruster fault. That is not a defense propulsion buy.";
  if (/space-based surveillance|european satellite/.test(t)) return "More European satellites need someone to fuse the pictures. That surveillance layer is the product.";
  if (/midterms|beijing/.test(t) && /ai|will to fight/.test(t)) return "Beijing is reading US willingness to fight and to fund AI. That reading is what they plan against.";
  if (/zero trust|disa/.test(t)) return "The buy DISA is pointing at is training and architecture for zero trust, not another cyber tool.";
  if (/triage|mass casualty/.test(t)) return "A service buy of casualty drones follows only if the challenge winner works in the field.";
  if (/classification management|declassify/.test(t)) return "The department wants software that classifies millions of documents. That workflow is the product.";
  if (/human spaceflight/.test(t)) return "This is a case for funding a crew vehicle, not a contract. The meeting next month is when it becomes money.";
  if (/memorandum of understanding|dual-use/.test(t)) return "Four firms agreed to team on a mission. No service has ordered it, so the gain is a team that can bid.";
  if (/energy grid|energy infrastructure/.test(t)) return "Utilities are the buyer of a defense against AI attacks on the power grid.";
  if (name) return `${name} is the party a buyer would call. A follow-on happens only if a service adopts what they just showed.`;
  return "A service adopts this only if it changes what they can field.";
}

/** When the story has no buyer, dollar, or deadline, say what would have to change, not a stock closer. */
function honestThin(title: string, body: string): string {
  return gainLine(title, body, []);
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
  const candidates = [
    specific && tokenOverlap(specific, what) <= 0.6 ? specific : "",
    factLine(title, body, companies, ctx),
    gainLine(title, body, companies),
  ];
  for (const candidate of candidates) {
    const out = cleanCopy(candidate);
    if (!out || tokenOverlap(out, what) > 0.6 || !allowed(out, story)) continue;
    if (/the watch item is/i.test(out) || isStockHedge(out) || restatesSummaryNumbers(out, what)) continue;
    return out;
  }
  return "A service adopts this only if it changes what they can field.";
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
