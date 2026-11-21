import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefTitle, classify, storyWhy } from "../src/classify.ts";
import { briefSummary, isListicle, pickTop, sameEvent, storyScore } from "../src/brief.ts";
import { summaryFromFields } from "../src/rss.ts";
import { extraCompany, junkMention, matchCompanies, resolveName } from "../src/names.ts";
import { updateFeedHealth, type FeedHealth, type FeedObservation } from "../src/feed-health.ts";

const GENERIC_SPACE = "More of the military's sensing and communications now runs through orbit, and new suppliers are getting in.";
const GENERIC_SEA = "The Navy is short of ships and is turning to cheaper unmanned boats, which opens the door to new builders.";
const GENERIC_STRIKE = "Weapons stockpiles are short, so anyone who can make missiles and rocket motors faster and cheaper has buyers.";
const GENERIC_GROUND = "Ground robots are moving from demos to real orders, starting with logistics and dangerous jobs.";

const lead = (title: string, body = "") => classify(title, body).sectors[0];
const why = (title: string, body = "", companies: string[] = []) => {
  const c = classify(title, body);
  return storyWhy(title, body, c.sectors[0], c.type, companies);
};

describe("sector scoring", () => {
  it("sends a Senate hearing about the Navy to policy, not maritime", () => {
    const c = classify(
      "Senate grills acting Navy secretary on Iran war costs, extended deployments",
      "The White House’s pick to lead the Navy didn’t have clear answers Tuesday when lawmakers pressed him about ballooning Iran war costs.",
    );
    assert.equal(c.sectors[0].id, "policy");
    assert.notEqual(c.sectors[0].id, "sea");
    assert.equal(c.type, "Policy & budget");
  });

  it("sends a laser that downs a missile to counter-drone, not munitions", () => {
    const c = classify(
      "Lockheed says its Valkyrie laser downs cruise missile",
      "A Lockheed Martin high-energy laser has destroyed a surrogate cruise missile target for the first time.",
    );
    assert.equal(c.sectors[0].id, "cuas");
    assert.ok(!c.sectors.slice(0, 1).some((s) => s.id === "strike"));
    assert.equal(c.type, "Tech milestone");
  });

  it("does not treat anti-tank as a tank, so the story stays with munitions", () => {
    const c = classify(
      "Chinese anti-tank missile spotted in Morocco",
      "Officer cadets fired a Chinese HJ-9A anti-tank missile from a Humvee.",
    );
    assert.equal(c.sectors[0].id, "strike");
    assert.ok(!c.sectors.some((s) => s.id === "ground"));
  });

  it("does not file rocket artillery under space", () => {
    const c = classify(
      "Elbit wins $260 million PULS rocket artillery deal from NATO",
      "Elbit Systems has won a contract worth about $260 million to supply PULS rocket artillery launchers and munitions.",
    );
    assert.equal(c.sectors[0].id, "strike");
    assert.ok(!c.sectors.some((s) => s.id === "space"));
    assert.equal(c.type, "Contract");
  });

  it("keeps an Abrams buy in ground robotics' lane", () => {
    assert.equal(lead("Army orders more Abrams tanks for the brigade").id, "ground");
  });

  it("does not read a howitzer battery as an energy storage story", () => {
    const c = classify("New Krab howitzer battery joins Poland’s Black Division", "Another battery of Krab self-propelled howitzers is being accepted.");
    assert.ok(!c.sectors.some((s) => s.id === "energy"));
  });

  it("does not read laser-guided as a directed-energy weapon", () => {
    const c = classify("Air Force drops a laser-guided bomb on a test range", "");
    assert.ok(!c.sectors.some((s) => s.id === "cuas"));
  });
});

describe("types and why lines", () => {
  it("types an FMS green light as a contract, not a merger", () => {
    const c = classify(
      "Tiny Albania gets green light to buy two HIMARS launchers",
      "The U.S. State Department approved a $210 million sale of two M142 HIMARS launchers and their guided rockets.",
    );
    assert.equal(c.type, "Contract");
    assert.notEqual(c.type, "M&A & IPO");
    assert.ok(!c.sectors.some((s) => s.id === "capital"));
    const line = why("Tiny Albania gets green light to buy two HIMARS launchers", "The U.S. State Department approved a $210 million sale of two M142 HIMARS launchers and their guided rockets.");
    assert.match(line, /HIMARS/);
    assert.match(line, /\$210 million/);
    assert.doesNotMatch(line, /investors put money/i);
    assert.doesNotMatch(line, /just put|count it as demand|treat the announcement as intent/i);
  });

  it("does not type a NATO software story as a conflict, and does not default the rest to a tech milestone", () => {
    const open = classify("OpenAI gives NATO access to most advanced cybersecurity AI", "NATO operators built and deployed AI agents in an exercise, with help from OpenAI.");
    assert.equal(open.type, "");
    assert.notEqual(open.type, "Conflict & allies");
    const interest = classify("U.S. Marines and Army show interest in Northrop’s 30mm gun truck", "The company said a version of the system shot down multiple drones.");
    assert.equal(interest.type, "");
  });

  it("writes a Space Force budget line from the figure, not the sector boilerplate", () => {
    const title = "Senate Backs Bigger Space Force, but Trims Pentagon Plans";
    const body = "The Senate Appropriations Committee approved a plan to raise investment in the Space Force by 73 percent over 2026. Under the plan, the Space Force would get $54.7 billion, up from $31.6 billion this year.";
    const line = why(title, body);
    assert.match(line, /Space Force/);
    assert.match(line, /73%/);
    assert.match(line, /\$54\.7 billion/);
    assert.notEqual(line, GENERIC_SPACE);
  });

  it("writes the Elbit and Valkyrie lines from the deal and the weapon", () => {
    const elbit = why(
      "Elbit wins $260 million PULS rocket artillery deal from NATO",
      "Elbit Systems has won a contract worth about $260 million to supply PULS rocket artillery launchers and munitions.",
    );
    assert.match(elbit, /\$260 million/);
    assert.match(elbit, /PULS/);
    assert.notEqual(elbit, GENERIC_SPACE);
    assert.notEqual(elbit, GENERIC_STRIKE);
    const laser = why(
      "Lockheed says its Valkyrie laser downs cruise missile",
      "A Lockheed Martin high-energy laser has destroyed a surrogate cruise missile target for the first time.",
      ["Lockheed Martin"],
    );
    assert.match(laser, /Valkyrie/);
    assert.match(laser, /cruise-missile|destroyed/i);
    assert.notEqual(laser, GENERIC_STRIKE);
    assert.doesNotMatch(laser, /count it as demand|just put .+ in play/i);
  });

  it("says what the Navy hearing is about, not that the Navy wants unmanned boats", () => {
    const line = why(
      "Senate grills acting Navy secretary on Iran war costs, extended deployments",
      "The White House’s pick to lead the Navy didn’t have clear answers Tuesday when lawmakers pressed him about ballooning Iran war costs.",
    );
    assert.match(line, /Iran war costs/);
    assert.notEqual(line, GENERIC_SEA);
  });

  it("still writes a line when the sector match is only a passing mention", () => {
    const title = "Office picnic scheduled for Friday";
    const body = "A colleague mentioned the satellite photo in the newsletter.";
    const c = classify(title, body);
    assert.equal(c.sectors[0]?.id, "space");
    assert.ok(c.sectors[0].titleScore < 4);
    const line = storyWhy(title, body, c.sectors[0], c.type, []);
    assert.ok(line.length > 0);
    assert.notEqual(line, GENERIC_SPACE);
    assert.match(line, /satellite photo|picnic/i);
  });

  it("does not use the old ground-robot line on the Morocco missile", () => {
    const line = why("Chinese anti-tank missile spotted in Morocco", "Officer cadets fired a Chinese HJ-9A anti-tank missile from a Humvee.");
    assert.notEqual(line, GENERIC_GROUND);
    assert.match(line, /anti-tank/i);
  });
});

const STOCK = /just put .+ in play|count it as demand|treat the announcement as intent|treat it as intent until|in front of a buyer/i;

describe("published brief stories", () => {
  const stories: [string, string, string[]][] = [
    ["Lockheed gets $72.6M to speed up delayed F-35 Block 4 upgrade", "The U.S. Navy has added $72.6 million in scope to a Lockheed Martin F-35 development contract to accelerate the development of F-35 Lightning II Block 4 capabilities.", ["Lockheed Martin"]],
    ["Under $200,000 per missile: U.S. Army’s target for Stinger successor", "The U.S. Army is looking for a third contender to replace the Stinger missile. On Nov. 20, it asked industry for a ready-made alternate interceptor under its Next Generation Short Range Interceptor program, with a live-fire shootout planned for mid-2027.", []],
    ["Hegseth memo limits U.S.-Canada defense ties, report says", "Secretary of War Pete Hegseth has ordered new limits on how the U.S. military works with Canada, in a classified memo circulated last week.", []],
    ["Europeans, with Ukraine’s help, brace for more Russian attacks", "IZMIR, Turkey— Vladimir Putin would love to end the war, but European NATO members and Ukrainians are working to make sure Russia’s invasion of Ukraine doesn’t end on Moscow’s terms.", []],
    ["Putin’s National Guard division near Moscow gets heavy armor", "Russia’s National Guard, a force that answers directly to Vladimir Putin, has handed tanks to its best-known division outside Moscow.", []],
    ["BAE taps Leonardo DRS for next-gen THAAD seeker sensor", "Leonardo DRS will develop a next-generation infrared sensor for the THAAD missile defense interceptor under a contract from BAE Systems, the company said in a release on Thursday.", ["Leonardo DRS"]],
    ["Navy Awards 28 Spots on $7.1B SEWIP Contract", "The Navy has awarded 28 companies a potential $7.13 billion contract for Surface Electronic Warfare Improvement Program upgrades.", []],
    ["BAE opens UK’s first fully automated artillery shell plant", "BAE Systems has opened a new explosive filling plant at Glascoed that it says will raise its capacity to make 155mm artillery shells sixteen-fold.", ["BAE Systems"]],
    ["Louisiana Air Guard swaps airstrike unit for cyber squadron", "The Louisiana Air National Guard has turned its 122d Air Support Operations Squadron, a unit that called in airstrikes for ground troops, into a cyber defense squadron.", []],
  ];

  it("gives every one of those stories a non-empty line that is not a canned closer", () => {
    for (const [title, body, companies] of stories) {
      const c = classify(title, body);
      const line = storyWhy(title, body, c.sectors[0], c.type, companies);
      assert.ok(line.trim().length > 20, title);
      assert.doesNotMatch(line, STOCK, title);
      assert.doesNotMatch(line, /how the U\.$/);
    }
  });

  it("keeps the dollar amount and the program in the lines that have them", () => {
    const lockheed = why(stories[0][0], stories[0][1], stories[0][2]);
    assert.match(lockheed, /\$72\.6 million/);
    assert.match(lockheed, /F-35 Block 4/);
    assert.match(lockheed, /Navy/);
    const stinger = why(stories[1][0], stories[1][1]);
    assert.match(stinger, /under \$200,000/);
    assert.match(stinger, /Stinger/);
    assert.match(stinger, /mid-2027/);
    const sewip = why(stories[6][0], stories[6][1]);
    assert.match(sewip, /\$7\.13 billion/);
    assert.match(sewip, /28 companies/);
    assert.match(sewip, /SEWIP/);
    const hegseth = why(stories[2][0], stories[2][1]);
    assert.match(hegseth, /Canada/);
    assert.doesNotMatch(hegseth, /how the U\.$/);
  });
});

describe("ranking and the summary line", () => {
  it("ranks a contract roundup below a real award so it stays out of the top five", () => {
    const promo = {
      title: "4 Open DOW R D Contract Opportunities: Albatross UAS, Intrinsic Market Resilience More",
      body: "Check out these active Pentagon R D opportunities in technologies like UAS flight controls.",
      sectors: ["air"],
      d: "2026-11-20",
    };
    const real = [
      ["Navy Awards 28 Spots on $7.1B SEWIP Contract", "The Navy awarded 28 companies a $7.13 billion SEWIP contract.", "ew"],
      ["BAE opens UK’s first fully automated artillery shell plant", "BAE opened a 155mm shell plant.", "strike"],
      ["Hegseth memo limits U.S.-Canada defense ties", "Hegseth ordered limits on Canada.", "policy"],
      ["Putin’s National Guard division near Moscow gets heavy armor", "The National Guard got tanks.", "adversary"],
      ["Europeans brace for more Russian attacks", "NATO members are preparing for more attacks.", "global"],
    ] as const;
    const items = [
      { ...promo, score: storyScore({ type: "Contract", title: promo.title, body: promo.body, titleScore: 6 }) },
      ...real.map(([title, body, sector]) => ({ title, body, sectors: [sector], d: "2026-11-20", score: storyScore({ type: "Contract", title, body, titleScore: 6, companies: ["BAE Systems"] }) })),
    ];
    assert.ok(isListicle(promo.title, promo.body));
    assert.ok(items[0].score < items[1].score);
    const top = pickTop(items);
    assert.equal(top.length, 5);
    assert.ok(!top.some((s) => isListicle(s.title)));
  });

  it("lets one Senate appropriations bill take a single slot", () => {
    const items = [
      { title: "Senate Appropriators Cut $20B from Navy Shipbuilding Request", body: "Lawmakers cut the shipbuilding request.", sectors: ["sea"], score: 9, d: "2026-11-18" },
      { title: "A $1.1 trillion Pentagon budget plan sets up a fight on Capitol Hill", body: "Senate appropriators are prioritizing Golden Dome, drones and munitions.", sectors: ["policy"], score: 8, d: "2026-11-18" },
      { title: "Appropriators slash Trump’s $17B Golden Dome request in draft bill", body: "The committee cut the missile defense request.", sectors: ["missiledef"], score: 8, d: "2026-11-19" },
      { title: "Ukraine plans to double drone supplies, triple deep strikes", body: "Ukraine is expanding long-range strike with European partners.", sectors: ["air"], score: 6, d: "2026-11-19" },
    ];
    assert.ok(sameEvent(items[0], items[1]));
    assert.ok(sameEvent(items[0], items[2]));
    const top = pickTop(items);
    assert.equal(top.filter((s) => /appropriat/i.test(`${s.title} ${s.body}`)).length, 1);
    assert.ok(top.some((s) => /drone/i.test(s.title)));
  });

  it("names the top stories without a doubled colon", () => {
    const line = briefSummary(13, ["adversary", "adversary", "cyber"], ["air", "air", "strike"]);
    assert.equal(line, "13 new stories. Most came from China, Russia and Iran and cyber; the top five are mostly about drones and missiles and munitions.");
    assert.doesNotMatch(line, /areas:/);
    assert.doesNotMatch(line, /adversaries:/i);
  });
});

describe("brief title", () => {
  it("derives the day's title from the lead story and its standout percent", () => {
    const title = briefTitle(
      "Senate Backs Bigger Space Force, but Trims Pentagon Plans",
      "The Senate Appropriations Committee approved a plan to raise investment in the Space Force by 73 percent over 2026. The Space Force would get $54.7 billion.",
    );
    assert.equal(title, "Senate backs a 73% bigger Space Force");
  });

  it("uses the lead headline itself when there is no percent to fold in", () => {
    const title = briefTitle("Lockheed says its Valkyrie laser downs cruise missile", "A high-energy laser destroyed a surrogate target.");
    assert.match(title, /Valkyrie/);
    assert.notEqual(title, "Today's top defense-tech headlines");
  });
});

describe("company tags", () => {
  const directory = ["Defense Unicorns", "Anthropic · OpenAI · Google · xAI", "Lockheed Martin", "Elbit Systems"];

  it("tags only the lab that appears, not the whole frontier group", () => {
    const hits = matchCompanies("OpenAI gives NATO access to most advanced cybersecurity AI", directory);
    assert.deepEqual(hits, ["OpenAI"]);
  });

  it("does not turn Secretary of Defense into Defense Unicorns", () => {
    const text = "Secretary of Defense Pete Hegseth made a surprise trip to Venezuela to sign an agreement.";
    assert.deepEqual(matchCompanies(text, directory), []);
    assert.equal(resolveName("Defense", text, directory), null);
    assert.equal(junkMention("Defense", text), true);
  });

  it("drops a minister's job title split into fake companies", () => {
    const text = "Britain’s Minister for Defence Readiness and Industry makes the case for a UK frigate.";
    assert.equal(extraCompany("Defence Readiness", text), false);
    assert.equal(extraCompany("Industry", text), false);
    assert.equal(junkMention("Defence Readiness", text), true);
    assert.equal(junkMention("Industry", text), true);
  });

  it("maps a longer form onto the directory name and keeps a real non-directory company", () => {
    assert.equal(resolveName("Lockheed Martin Aeronautics", "Lockheed Martin Aeronautics won a role.", directory), "Lockheed Martin");
    assert.equal(extraCompany("AEVEX Corp", "AEVEX Corp raised its forecast."), true);
    assert.equal(extraCompany("109th Airlift Wing", "The 109th Airlift Wing deployed."), false);
  });
});

describe("article lede", () => {
  it("uses the opening paragraph instead of a pull quote stored in description", () => {
    const quote = "Democrats in particular bristled at Hung Cao’s characterization of unsuccessful suicide attempts as “mitigations.”";
    const encoded = "<p>The White House’s pick to lead the Navy didn’t have clear answers Tuesday when lawmakers pressed him about ballooning Iran war costs, the resulting toll on troops, and the service’s overall readiness during a Senate confirmation hearing.</p><p>Hung Cao said the war was a strain.</p>";
    const summary = summaryFromFields(quote, encoded);
    assert.match(summary, /Iran war costs/);
    assert.doesNotMatch(summary, /suicide/);
  });

  it("falls back to the description when the feed has no article body", () => {
    assert.equal(summaryFromFields("Elbit Systems won a $260 million contract for rocket artillery.", undefined), "Elbit Systems won a $260 million contract for rocket artillery.");
  });
});

describe("feed health", () => {
  const obs = (over: Partial<FeedObservation>): FeedObservation => ({
    name: "GovConWire",
    url: "https://feeds.feedburner.com/govconwire",
    fetched: 10,
    inWindow: 4,
    added: 2,
    duplicates: 0,
    newest: "2026-11-18",
    ...over,
  });

  const run = (prev: FeedHealth | null, row: FeedObservation, date: string) =>
    updateFeedHealth(prev, [row], date, `${date}T14:00:00.000Z`);

  it("flags a feed only after several straight runs with zero items", () => {
    let health: FeedHealth | null = null;
    for (const date of ["2026-11-15", "2026-11-16", "2026-11-17"]) {
      health = run(health, obs({ fetched: 0, inWindow: 0, added: 0, newest: undefined, error: "HTTP 403" }), date);
      assert.equal(health.feeds.GovConWire.flag, undefined);
    }
    health = run(health, obs({ fetched: 0, inWindow: 0, added: 0, newest: undefined, error: "HTTP 403" }), "2026-11-18");
    assert.match(health.feeds.GovConWire.flag ?? "", /0 items for 4 straight runs/);
    assert.match(health.feeds.GovConWire.flag ?? "", /HTTP 403/);
  });

  it("flags a feed whose newest item is years old", () => {
    let health: FeedHealth | null = null;
    const stale = obs({ fetched: 10, inWindow: 0, added: 0, newest: "2016-03-03" });
    for (const date of ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"]) {
      health = run(health, stale, date);
    }
    assert.match(health!.feeds.GovConWire.flag ?? "", /no recent items/);
  });

  it("flags a feed that only repeats another outlet", () => {
    let health: FeedHealth | null = null;
    const shadow = obs({ fetched: 10, inWindow: 4, added: 0, duplicates: 4, newest: "2026-11-18" });
    for (let day = 14; day <= 18; day++) health = run(health, shadow, `2026-11-${day}`);
    assert.match(health!.feeds.GovConWire.flag ?? "", /duplicated another feed/);
  });

  it("leaves a live feed unflagged and drops a feed that is no longer collected", () => {
    const health = updateFeedHealth(
      { updatedAt: "", feeds: { CSIS: { url: "https://www.csis.org/rss.xml", runs: [], flag: "stale" } } },
      [obs({})],
      "2026-11-18",
      "2026-11-18T14:00:00.000Z",
    );
    assert.equal(health.feeds.GovConWire.flag, undefined);
    assert.equal(health.feeds.CSIS, undefined);
  });
});
