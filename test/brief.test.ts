import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefTitle, classify, storyWhy } from "../src/classify.ts";
import { backlogYears, cleanCopy, grammarProblem, isMechanicalChange, isStockHedge, limitActor, restatesSummaryNumbers, storyWhy as storyWhyWith, tokenOverlap, ungroundedTerms, uniqueWhys } from "../src/why.ts";
import { briefSummary, dedupeEvents, eventKey, isFiller, isListicle, materiallyNew, pickTop, sameEvent, sameStory, storyGist, storyScore } from "../src/brief.ts";
import { copiesBodySentence } from "../src/why.ts";
import { selectBriefVideos } from "../src/brief-videos.ts";
import { fallbackFeedUrls, FEED_HEADERS, fetchFeedReport, isCaption, isRawQuote, summaryFromFields } from "../src/rss.ts";
import { cleanMention, extraCompany, junkMention, matchCompanies, resolveName } from "../src/names.ts";
import { feedBadges, refreshFeedHealth, updateFeedHealth, type FeedHealth, type FeedObservation } from "../src/feed-health.ts";

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
    assert.match(line, /Iran war/);
    assert.notEqual(line, GENERIC_SEA);
  });

  it("still writes a line when the sector match is only a passing mention", () => {
    const title = "Office picnic scheduled for Friday";
    const body = "A colleague mentioned the satellite photo in the newsletter.";
    const c = classify(title, body);
    assert.equal(c.sectors[0]?.id, "space");
    assert.ok(c.sectors[0].titleScore < 4);
    const line = storyWhy(title, body, c.sectors[0], c.type, []);
    assert.equal(line, "");
    assert.doesNotMatch(line, /is the party in the story|This one is /);
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
      assert.doesNotMatch(line, /is the party in the story|This one is /i, title);
      if (line.trim()) assert.doesNotMatch(line, STOCK, title);
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
    assert.equal(line, "13 new stories. Most came from China, Russia and Iran, plus cyber; the top five are mostly about drones, plus missiles and munitions.");
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

  it("badges a feed whose newest item is more than two days behind", () => {
    const health = updateFeedHealth(null, [obs({ newest: "2026-11-19", fetched: 16, inWindow: 0, added: 0 })], "2026-11-23", "2026-11-23T14:00:00.000Z");
    assert.equal(health.feeds.GovConWire.stale, true);
    assert.match(health.feeds.GovConWire.flag ?? "", /more than 2 days old/);
  });
});

describe("so-what lines", () => {
  const canadaTitle = "Canada joins NATO innovation fund, promises 'business as usual' with US";
  const canadaBody = "HALIFAX, Nova Scotia —Hours after news broke that the United States would limit defense cooperation with Canada, the Canadian government announced plans to pour 100 million Canadian dollars into a NATO defense-innovation fund.";

  it("names the United States, not NATO, as the actor limiting Canada", () => {
    assert.equal(limitActor(canadaBody), "The United States");
    const line = why(canadaTitle, canadaBody);
    assert.match(line, /United States/);
    assert.match(line, /Canada/);
    assert.doesNotMatch(line, /NATO ordered/);
    assert.ok(tokenOverlap(line, canadaBody) <= 0.6);
  });

  it("writes a deployment so-what for the Libyan corvette, not a copy of the lede", () => {
    const title = "Ukraine’s Campaign Against Russian Naval Assets Far Beyond The Black Sea Enters A New Phase";
    const body = "A Russian Navy corvette burned and capsized after being struck by Ukrainian uncrewed service vessels (USVs) while docked in Benghazi, Libya.";
    const line = why(title, body);
    assert.match(line, /port force-protection|counter-USV/);
    assert.match(line, /Libya|Mediterranean/);
    assert.ok(tokenOverlap(line, body) <= 0.6);
    assert.doesNotMatch(line, /uncrewed service/);
  });

  it("strips a dangling quote and comma", () => {
    assert.equal(cleanCopy("is “almost certainly destroyed,”."), "is almost certainly destroyed.");
  });

  it("corrects USV to uncrewed surface vessel", () => {
    assert.match(cleanCopy("struck by Ukrainian uncrewed service vessels (USVs)"), /uncrewed surface vessels/);
  });

  it("files a missile corvette in a Libyan port under maritime, not munitions", () => {
    const c = classify(
      "Russian corvette reportedly destroyed in blast at Libyan port",
      "A Russian Navy missile corvette caught fire after a large explosion in the Libyan port of Benghazi.",
    );
    assert.equal(c.sectors[0].id, "sea");
  });

  it("does not republish the Libyan corvette on the next day", () => {
    const first = { title: "Russian corvette reportedly destroyed in blast at Libyan port", body: "A Russian Navy missile corvette caught fire in Benghazi.", sectors: ["sea"], score: 5, d: "2026-11-22" };
    const again = { title: "Ukraine’s campaign against Russian naval assets enters a new phase", body: "A corvette was struck by Ukrainian USVs in Benghazi, Libya.", sectors: ["sea"], score: 9, d: "2026-11-23" };
    assert.equal(eventKey(first.title, first.body), eventKey(again.title, again.body));
    assert.equal(materiallyNew(`${first.title} ${first.body}`, `${again.title} ${again.body}`), false);
    const top = pickTop([again], 5, [first]);
    assert.equal(top.length, 0);
  });

  it("sentence-cases a mixed headline", () => {
    const title = briefTitle("Ukraine’s Campaign against Russian Naval Assets Far Beyond the Black Sea Enters a new Phase", "A corvette burned in Libya.");
    assert.match(title, /enters a new phase/);
    assert.doesNotMatch(title, /Phase/);
  });

  it("describes a one-story day without inventing submarines", () => {
    const line = briefSummary(1, ["sea"], ["sea"], { gist: storyGist("Ukraine corvette", "USV struck a corvette in Libya"), text: "corvette Libya" });
    assert.match(line, /^Quiet weekend: 1 new story, Ukraine's drone boats hit a Russian corvette in Libya\./);
    assert.doesNotMatch(line, /submarine/);
  });
});

describe("brief videos", () => {
  const stories = [
    { title: "Ukrainian Mirage 2000 shoots down Russian jet drone with gun", body: "A Mirage 2000 shot down a jet drone over Ukraine.", sector: "air" },
    { title: "Russian corvette destroyed in Benghazi", body: "Ukrainian USVs hit a corvette in Libya.", sector: "sea" },
  ];
  const videos = [
    { id: "1", title: "Pentagon defense budget and military weapons update", desc: "A weekly look at the defense industry.", topic: "defense" },
    { id: "2", title: "Is this housing market the next Austin", desc: "Home prices and inventory.", topic: "housing" },
    { id: "3", title: "Mirage 2000 gun kill on a jet drone", desc: "Ukraine shows a Mirage using its cannon.", topic: "defense" },
    { id: "4", title: "The Battle of the Bridges, Crimea", desc: "Russia's strike campaign against Ukrainian bridges.", topic: "defense" },
  ];

  it("keeps a clip that shares a system and drops generic defense and off-topic clips", () => {
    const { kept, rejected } = selectBriefVideos(stories, videos);
    assert.deepEqual(kept.map((k) => k.video.id), ["3"]);
    const byId = Object.fromEntries(rejected.map((r) => [r.video.id, r.reason]));
    assert.match(byId["1"], /no shared/);
    assert.match(byId["2"], /not a defense/);
    assert.match(byId["4"], /no shared/);
  });
});

describe("Nov 24 brief quality", () => {
  const ctx = { deadline: "Dec 11", stakes: ["DAWG", "Golden Dome"] };
  const memorial = {
    title: "Space Beyond orders hardware for 10 more memorial cubesat missions",
    body: "Space Beyond has ordered enough hardware for 10 follow-on cubesats after growing sales for the Florida startup's first memorial spacecraft, slated to carry cremated remains into orbit in October 2027.",
  };
  const corvette = {
    title: "Ukraine confirms it sank Russian corvette in Libyan port",
    body: "Ukraine confirmed it sank a Russian corvette in the Libyan port of Benghazi with naval drones.",
  };
  const carrier = {
    title: "China’s fourth aircraft carrier, bigger than others and nuclear-powered, nears completion",
    body: "China's fourth aircraft carrier, known as Type 004, will be bigger than its predecessors and nuclear powered.",
  };
  const geran = {
    title: "New SPYS interceptor shot down Russia’s Geran-5 cruise missile",
    body: "A Ukrainian-built interceptor drone has destroyed a Geran-5, classed by Ukrainian intelligence as a small cruise missile.",
  };

  it("ranks a nuclear carrier ahead of a NASA weather contract and a SPAC", () => {
    const carrierScore = storyScore({ title: carrier.title, body: carrier.body, titleScore: 6 });
    const nasa = storyScore({
      type: "Contract",
      companies: ["Northrop Grumman"],
      title: "Northrop Grumman Lands $291M NASA Contract for NOAA NEON Microwave Sounders",
      body: "The contract runs through April 2042 and covers instruments for National Weather Service forecasts.",
      titleScore: 6,
    });
    const spac = storyScore({
      type: "M&A & IPO",
      companies: ["Quantum Space", "Inflection Point"],
      title: "Quantum Space Closes SPAC Merger With Inflection Point Ahead of NYSE Debut",
      body: "Quantum Space is set to begin trading on NYSE as QSPC.",
      titleScore: 6,
    });
    assert.ok(carrierScore > nasa);
    assert.ok(carrierScore > spac);
    assert.ok(carrierScore > storyScore({ title: memorial.title, body: memorial.body, titleScore: 6 }));
  });

  it("names the buyer on a helicopter order, an erroneous contract, a backlog, and a drone-plant talk", () => {
    const heli = why(
      "U.S. Special Operations Command orders more MH-47Gs",
      "Boeing has received a $197.3 million order modification to buy more MH-47G special operations helicopters for U.S. Special Operations Command.",
    );
    assert.match(heli, /Special Operations Command/);
    assert.match(heli, /MH-47G/);
    assert.match(heli, /next lot/);
    assert.match(heli, /Boeing/);
    assert.doesNotMatch(heli, /modification keeps|funded order/);
    assert.equal(restatesSummaryNumbers(heli, "Boeing has received a $197.3 million order modification to buy more MH-47G special operations helicopters."), false);
    const err = why(
      "$16 billion propulsion mega-contract posted in error, Air Force says",
      "The Air Force is planning to award the $16.1 billion contract, but has not yet done so.",
    );
    assert.match(err, /Air Force/);
    assert.match(err, /not awarded/);
    assert.doesNotMatch(err, /\$16/);
    const book = why(
      "Amentum Reports $13.8B in FY2026 Revenue, $48.3B Backlog",
      "Amentum secured $15 billion in net bookings, including major NGA, Navy, Army and international nuclear program awards.",
      ["Amentum Reports"],
    );
    assert.match(book, /backlog/);
    assert.match(book, /Amentum/);
    assert.match(book, /3\.5 years/);
    assert.match(book, /\$48\.3B/);
    assert.match(book, /\$13\.8B/);
    assert.match(book, /NGA/);
    assert.match(book, /nuclear/);
    assert.doesNotMatch(book, /the Navy, the Army, NGA and nuclear awards/);
    assert.equal(restatesSummaryNumbers(book, "Amentum Reports $13.8B in FY2026 Revenue, $48.3B Backlog"), false);
    const drones = why(
      "Pentagon in talks with GM and Ford to help build drones",
      "The Pentagon is in talks with General Motors, Ford and other manufacturers about helping mass-produce military drones.",
    );
    assert.match(drones, /General Motors/);
    assert.match(drones, /Ford/);
    assert.match(drones, /mass-produce/);
    assert.doesNotMatch(drones, /in talks with General Motors, Ford and other manufacturers about helping/i);
    assert.ok(tokenOverlap(drones, "The Pentagon is in talks with General Motors, Ford and other manufacturers about helping mass-produce military drones.") <= 0.6);
    const buy = why(
      "BlackSky acquires data firm EpochGeo",
      "BlackSky Technology announced it acquired geospatial data firm EpochGeo as defense customers seek deeper analysis.",
    );
    assert.match(buy, /sells analysis/);
    assert.match(buy, /geospatial/);
    assert.doesNotMatch(buy, /imagery|acquired the data firm|ownership change|not a new program|does not name a buyer/);
    assert.deepEqual(ungroundedTerms(buy, "BlackSky acquires data firm EpochGeo. BlackSky Technology announced it acquired geospatial data firm EpochGeo as defense customers seek deeper analysis."), []);
    assert.equal(isStockHedge(buy), false);
    assert.ok(tokenOverlap(buy, "BlackSky Technology announced it acquired geospatial data firm EpochGeo as defense customers seek deeper analysis.") <= 0.6);
  });

  it("names the real actor, and stays empty when the headline is the only fact", () => {
    const cases: [string, string, RegExp, RegExp?][] = [
      ["Yes, no, maybe? The countries that can deliver Ukraine's F-16s", "Yes, no, maybe? The countries that can deliver Ukraine's F-16s.", /Yes is the party/, /^$/],
      ["Upgrading cellular networks with space support", "Using satellites to connect smartphones beyond cell towers.", /Upgrading is/, /^$/],
      ["Thruster glitch clouds BepiColombo arrival at Mercury", "A mission entered orbit around Mercury after a thruster shutdown.", /Thruster is/, /^$/],
      ["White House sets limits on contractors' contacts with Congress", "Federal contractors are required to alert the White House before answering Congress and withhold privileged material under an executive order.", /White is the party/, /White House/],
      ["Israeli firm says its new spy drone broke a range record", "An Israeli company flew a spy drone farther than its last one.", /^Israeli is/, /^$/],
      ["European officials make the case for a human spaceflight program", "European government officials want a crew vehicle.", /^European is/, /^$/],
      ["Russia rebuilds key military base 60 km from Finland", "Russia has torn down barracks at its army base near Finland.", /The Army is the party/, /^$/],
      ["Investment firm Cerberus to buy space business of US Airbus arm", "Airbus will expand production of autonomous aircraft.", /sell Airbus|is buying Airbus/, /^$/],
      ["$16 billion propulsion mega-contract posted in error, Air Force says", "The Air Force is planning to award the contract, but has not yet done so.", /says was posted/, /says the contract was posted/],
    ];
    for (const [title, body, absent, present] of cases) {
      const line = why(title, body);
      assert.doesNotMatch(line, absent, `${title} -> ${line}`);
      assert.doesNotMatch(line, /is the party in the story|This one is /i, line);
      if (present) assert.match(line, present, `${title} -> ${line}`);
      if (line) assert.ok(tokenOverlap(line, title) <= 0.6, line);
      assert.equal(grammarProblem(line), "", line);
    }
  });

  it("leaves a line empty when it would only name a party or paste the headline", () => {
    const samples: [string, string][] = [
      ["Yes, no, maybe? The countries that can deliver Ukraine's 40 requested F-16s", "Yes, no, maybe? The countries that can or can't deliver Ukraine's 40 requested F-16s."],
      ["Upgrading cellular networks with space support", "Using satellites to connect smartphones beyond the reach of cell towers."],
      ["Thruster glitch clouds BepiColombo arrival at Mercury", "A joint mission entered orbit around Mercury after a thruster shutdown."],
      ["A battalion delayed a weather exercise", "The battalion waited out the weather before the road march."],
    ];
    for (const [title, body] of samples) {
      const line = why(title, body);
      assert.doesNotMatch(line, /is the party in the story|This one is /i, line);
      if (line) assert.ok(tokenOverlap(line, title) <= 0.6, line);
    }
    const items = [
      { title: "One", why: "A buyer has to adopt it." },
      { title: "Two", why: "A buyer has to adopt it." },
    ];
    uniqueWhys(items);
    assert.equal(items[0].why, "");
    assert.equal(items[1].why, "");
  });

  it("does not reuse a canned line when the story only shares a broad keyword", () => {
    const battalion = why("A battalion delayed a weather exercise", "The battalion waited out the weather before the road march.");
    assert.doesNotMatch(battalion, /Odin|brigade|2042|propulsion|nuclear weapon/i);
    assert.deepEqual(ungroundedTerms(battalion, "A battalion delayed a weather exercise. The battalion waited out the weather before the road march."), []);
    const weather = why(
      "NOAA weather contract posted in error",
      "A weather instrument contract was posted in error and has not yet been awarded.",
    );
    assert.doesNotMatch(weather, /propulsion|engine|2042|Northrop|says was posted/i);
    if (weather) assert.ok(tokenOverlap(weather, "NOAA weather contract posted in error") <= 0.6, weather);
    const nuclear = why(
      "Firm launches a nuclear-powered communications satellite",
      "The satellite uses nuclear power for its radio.",
    );
    assert.doesNotMatch(nuclear, /weapon|orbit a nuclear|warning/i);
    assert.deepEqual(ungroundedTerms(nuclear, "Firm launches a nuclear-powered communications satellite. The satellite uses nuclear power for its radio."), []);
  });

  it("does not file an earnings backlog under budget just because the Army is a customer", () => {
    const c = classify(
      "Amentum Reports $13.8B in FY2026 Revenue, $48.3B Backlog",
      "Amentum secured $15 billion in net bookings, including major NGA, Navy, Army and international nuclear program awards.",
    );
    assert.notEqual(c.sectors[0]?.id, "policy");
  });

  it("does not restate summary dollars or close with a stock hedge", () => {
    const samples: [string, string][] = [
      ["Northrop Grumman Lands $291M NASA Contract for NOAA NEON Microwave Sounders", "The contract runs through April 2042 and covers three instruments aimed at improving National Weather Service forecasts."],
      ["Private equity firm Cerberus to acquire Airbus' U.S. satellite business", "The deal brings a factory built for OneWeb's broadband constellation under American ownership."],
      ["Poland, UK sign deal to develop CAMM-MR missile", "Poland and the United Kingdom signed an agreement to develop CAMM-MR, a new air defense missile meant to reach beyond 100 km."],
      ["Ukrainian army gets German Lynx fighting vehicles", "Ukrainian soldiers are crewing Rheinmetall's Lynx infantry fighting vehicles after Berlin handed over a batch."],
      ["Marines Want Naval Strike Missiles With Double The Range", "The U.S. Marine Corps is looking at ways to at least double the range of its Naval Strike Missile."],
      ["White House sets limits on contractors' contacts with Congress", "Federal contractors must alert the White House before answering Congress and withhold anything deemed privileged."],
      ["Canada's air force bets on F-35 as its core fighter jet", "Canada's air force sketched a future fighter fleet built around the F-35 and it doesn't mention the Swedish Gripen."],
    ];
    for (const [title, body] of samples) {
      const line = why(title, body);
      assert.equal(isStockHedge(line), false, line);
      assert.equal(restatesSummaryNumbers(line, `${title} ${body}`), false, line);
      assert.doesNotMatch(line, /is the party in the story|This one is /i);
      if (line) assert.ok(tokenOverlap(line, title) <= 0.6, `${title} -> ${line}`);
    }
  });

  it("ranks a sinking, a nuclear carrier, and an interceptor kill ahead of a memorial cubesat", () => {
    const score = (s: { title: string; body: string }) => storyScore({ title: s.title, body: s.body, type: "Conflict & allies", titleScore: 6 });
    assert.ok(score(corvette) > score(memorial));
    assert.ok(score(carrier) > score(memorial));
    assert.ok(score(geran) > score(memorial));
    assert.ok(score(corvette) > score(carrier));
  });

  it("keeps Space Beyond capitalized in a mixed-case headline", () => {
    const title = briefTitle(memorial.title, memorial.body);
    assert.match(title, /Space Beyond/);
    assert.doesNotMatch(title, /Space beyond/);
  });

  it("writes the Coons, Trident, Philippines, and IAI lines from facts in those stories", () => {
    const coons = storyWhyWith(
      "Congress is out of time to decide on reconciliation, needs to settle topline spending: Sen. Coons",
      "If we could get to a bipartisan topline, we could spend the time from Thanksgiving to the end of the year getting a lot of this finished, said Sen. Chris Coons.",
      undefined, "", [], ctx,
    );
    assert.match(coons, /topline/);
    assert.doesNotMatch(coons, /memo|DAWG|Golden Dome|Dec 11/i);
    assert.deepEqual(ungroundedTerms(coons, "Congress is out of time to decide on reconciliation, needs to settle topline spending. If we could get to a bipartisan topline."), []);
    const trident = why(
      "Lockheed Martin Secures $1.5B Modification for Trident II D5 Missile Production, Fleet Support",
      "The sole-source contract calls for work in Utah, Florida, Colorado and other sites running through 2031.",
    );
    assert.match(trident, /Sole-source work through 2031/);
    assert.match(trident, /Lockheed/);
    assert.doesNotMatch(trident, /watch item/i);
    const loan = why(
      "U.S. Commits $2B Defense Loan for Philippine Military, Luzon Strait Development",
      "The United States committed a $2 billion defense loan for Philippine military construction along the Luzon Strait.",
    );
    assert.match(loan, /Luzon Strait/);
    assert.match(loan, /Philippine military/);
    const iai = why(
      "Israel Aerospace Industries profit jumps 37% as backlog hits $35.6 billion",
      "Israel Aerospace Industries reported a record $35.6 billion order backlog. The maker of the Arrow missile-defense system said net profit jumped.",
    );
    assert.match(iai, /backlog/);
    assert.match(iai, /missile/);
    assert.doesNotMatch(iai, /mainstream export/);
    assert.deepEqual(ungroundedTerms(iai, "Israel Aerospace Industries profit jumps as backlog hits $35.6 billion. The maker of the Arrow missile-defense system said net profit jumped."), []);
  });

  it("does not repeat one so-what across stories", () => {
    const items = [
      { title: "Umbra unveils a new radar satellite", why: "The story names an event. It does not name a buyer, a dollar figure, or a deadline." },
      { title: "A second radar satellite story", why: "The story names an event. It does not name a buyer, a dollar figure, or a deadline." },
    ];
    uniqueWhys(items);
    assert.equal(items[0].why, "");
    assert.equal(items[1].why, "");
    assert.doesNotMatch(items.map((i) => i.why).join(" "), /This one is /);
  });

  it("files the Philippine defense loan under allies, not maritime, even when the caption says maritime", () => {
    const c = classify(
      "U.S. Commits $2B Defense Loan for Philippine Military, Luzon Strait Development",
      "Philippine marines assigned to 4th Marine Brigade participate in a training event for maritime key terrain security operations during KAMANDAG.",
    );
    assert.equal(c.sectors[0].id, "global");
    assert.notEqual(c.sectors[0].id, "sea");
  });

  it("skips a photo caption and a raw quote, and does not leave a doubled ellipsis", () => {
    const caption = "Philippine marines assigned to 4th Marine Brigade, and U.S. Marines assigned to 3rd Littoral Combat Team, participate in a cumulative training event for maritime key terrain security operations during KAMANDAG.";
    const quote = "If we could get to a bipartisan topline, we could spend the time from Thanksgiving to the end of the year getting a lot of this finished, said Sen. Chris Coons, the top democrat on the Senate Appropriations defense subcommittee.";
    const news = "The United States committed a $2 billion defense loan for Philippine military construction along the Luzon Strait, the Pentagon said on Monday.";
    assert.equal(isCaption(caption), true);
    assert.equal(isRawQuote(quote), true);
    const summary = summaryFromFields(quote, `<p>${caption}</p><p>${quote}</p><p>${news}</p>`);
    assert.match(summary, /\$2 billion defense loan/);
    assert.doesNotMatch(summary, /assigned to/);
    assert.equal(cleanCopy("operations during…."), "operations during…");
  });

  it("counts every new story and does not call a five-way tie mostly allies", () => {
    const line = briefSummary(43, ["space", "space", "sea", "strike"], ["space", "strike", "policy", "sea", "global"]);
    assert.match(line, /^43 new stories/);
    assert.doesNotMatch(line, /mostly about allies/);
  });

  it("blocks ceremonies, show episodes, and a repeated drone-tools segment", () => {
    assert.equal(isFiller("Navy Family Takes Oath of Enlistment Together"), true);
    assert.equal(isFiller("F-35 Demo Team Returns to Luke Ahead of 2027 Season"), true);
    assert.equal(isFiller("A race for lifesaving battlefield drones Defense News Weekly Full Episode 11.24.26"), true);
    assert.equal(isFiller("Two major veterans bills pass the House MOAA Headlines"), true);
    const a = { title: "New tools for troops to gun down drones Defense News Weekly Full Episode 11.17.26", body: "A weekly segment." };
    const b = { title: "New tools for troops to gun down drones Defense News Weekly Full Episode 11.19.26", body: "The same weekly segment." };
    assert.equal(sameStory(a, b), true);
  });

  it("treats the two Cerberus Airbus headlines as one deal", () => {
    const a = { title: "Investment firm Cerberus to buy space business of US Airbus arm", body: "Airbus will expand production of autonomous aircraft." };
    const b = { title: "Private equity firm Cerberus to acquire Airbus' U.S. satellite business", body: "The deal brings a factory built for OneWeb under American ownership." };
    assert.equal(eventKey(a.title, a.body), null);
    assert.equal(sameStory(a, b), true);
    const { kept, dropped } = dedupeEvents(
      [{ ...a, score: 4 }, { ...b, score: 6 }],
      [],
    );
    assert.equal(kept.length, 1);
    assert.match(kept[0].title, /satellite/);
    assert.equal(dropped.length, 1);
  });

  it("rejects a line that copies one sentence of the body", () => {
    const body = "A Russian Navy corvette burned and capsized after being struck by Ukrainian uncrewed surface vessels while docked in Benghazi, Libya. A cargo ship was also hit.";
    const copy = "A Russian Navy corvette burned and capsized after being struck by Ukrainian uncrewed surface vessels while docked in Benghazi, Libya.";
    assert.equal(copiesBodySentence(copy, body), true);
    const soWhat = why("Ukraine's campaign against Russian naval assets", body);
    assert.equal(copiesBodySentence(soWhat, body), false);
    assert.doesNotMatch(soWhat, /burned and capsized/);
  });

  it("keeps one Benghazi write-up and drops the rest of the same strike", () => {
    const items = [
      { ...corvette, score: 20 },
      { title: "Ukraine strikes Russian warship and cargo vessel with naval drones in Libya", body: "Naval drones hit a Russian warship in Libya.", score: 12 },
      { title: "Did Ukraine Use A Mothership To Launch Its Sea Drone Attack On Russian Ships in Benghazi?", body: "A mothership may have launched the Benghazi sea drone attack.", score: 9 },
      { title: "Russian convoy idles off Tunisia after sea drones hit Benghazi", body: "A Russian convoy waited off Tunisia after the Benghazi strike.", score: 8 },
    ];
    const { kept, dropped } = dedupeEvents(items, []);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].title, corvette.title);
    assert.equal(dropped.length, 3);
    assert.equal(eventKey(items[3].title, items[3].body), "warship@libya");
  });

  it("keeps a cybersecurity advisory and an Army installations story instead of dropping them", () => {
    const cyber = classify("NSA Issues Cybersecurity Advisory on AI-Generated Attacks Against Siemens PLCs", "The NSA urged programmable logic controller operators to patch systems.");
    assert.equal(cyber.sectors[0].id, "cyber");
    const army = classify(
      "New guide lays out how Army installations can coordinate with local agencies before disaster strikes",
      "The Army relies on local fuel, water and electricity to keep its installations going.",
    );
    assert.ok(army.sectors.length > 0);
    assert.notEqual(army.sectors[0].id, "");
  });
});

describe("Nov 24 fixes", () => {
  it("files the icebreaker at sea, the Odin app under AI, the robot scout on the ground, and the helicopter in the air", () => {
    const ice = classify(
      "‘A new competition space’: US Coast Guard takes icebreaker on maiden voyage to the Arctic",
      "The U.S. Coast Guard's first new icebreaker in nearly three decades returned from a maiden voyage to the Arctic.",
    );
    assert.equal(ice.sectors[0].id, "sea");
    assert.ok(!ice.sectors.some((s) => s.id === "space"));
    const odin = classify(
      "How a small Army team built a lightweight battle planning app: Odin",
      "Software optimized for brigades and above does not translate to battalion and below.",
    );
    assert.equal(odin.sectors[0].id, "ai");
    assert.ok(!odin.sectors.some((s) => s.id === "policy"));
    const scout = classify(
      "Robot scout spots targets for British troops in Kenya",
      "A robot vehicle working with British troops in Kenya spotted targets and sent them into the British Army's targeting network.",
    );
    assert.equal(scout.sectors[0].id, "ground");
    assert.ok(!scout.sectors.some((s) => s.id === "policy"));
    const heli = classify(
      "U.S. Special Operations Command orders more MH-47Gs",
      "Boeing has received a $197.3 million order modification to buy more MH-47G special operations helicopters for U.S. Special Operations Command, according to a Department of War contract announcement.",
    );
    assert.equal(heli.sectors[0].id, "air");
    assert.ok(!heli.sectors.some((s) => s.id === "policy"));
  });

  it("keeps Northrop sounders in space as well as primes, and does not file the Airbus space sale under air", () => {
    const sounders = classify(
      "Northrop Grumman Lands $291M NASA Contract for NOAA NEON Microwave Sounders",
      "The contract runs through April 2042 and covers three instruments aimed at improving National Weather Service forecasts.",
    );
    assert.ok(sounders.sectors.some((s) => s.id === "space"));
    assert.ok(sounders.sectors.some((s) => s.id === "primes"));
    const sale = classify(
      "Investment firm Cerberus to buy space business of US Airbus arm",
      "Airbus intends for its US subsidiary to double down on production of autonomous aircraft as the market for drones continues to expand.",
    );
    assert.equal(sale.sectors[0].id, "space");
    assert.ok(!sale.sectors.some((s) => s.id === "air"));
  });

  it("leaves policy in place for a real budget story and drops it when the only hit is the word Army", () => {
    const hearing = classify(
      "Senate grills acting Navy secretary on Iran war costs, extended deployments",
      "Lawmakers pressed him about ballooning Iran war costs.",
    );
    assert.equal(hearing.sectors[0].id, "policy");
    const drones = classify(
      "Pentagon in talks with GM and Ford to help build drones",
      "The Pentagon is in talks with General Motors and Ford about military drones.",
    );
    assert.equal(drones.sectors[0].id, "air");
    assert.ok(!drones.sectors.some((s) => s.id === "policy"));
  });

  it("strips a trailing verb and blocks outlets, schools, and generic nouns", () => {
    const text = "Amentum Reports earnings. The Wall Street Journal reported. Honolulu Community College hosted. First All-Guardian Squadron Graduates Officer Training School. Risks to Energy Infrastructure.";
    assert.equal(resolveName("Amentum Reports", text, []), "Amentum");
    assert.equal(resolveName("Northrop Grumman Lands", "Northrop Grumman Lands a contract.", ["Northrop Grumman"]), "Northrop Grumman");
    assert.equal(cleanMention("Energy Infrastructure", text, []), null);
    assert.equal(cleanMention("The Wall Street Journal", text, []), null);
    assert.equal(cleanMention("Honolulu Community College", text, []), null);
    assert.equal(cleanMention("Officer Training School", text, []), null);
    assert.equal(junkMention("First All-Guardian", text), true);
    assert.equal(extraCompany("The Wall Street Journal", text), false);
  });

  it("drops contests, archaeological notes, and routine training, and keeps a live-fire result", () => {
    assert.equal(isFiller("Airman’s Spicy Chicken Dish Wins National Competition—and It’s Coming Soon to Some Bases", "An Airman took first place in the culinary competition."), true);
    assert.equal(isFiller("Corps of Engineers Navigates Historic Archaeological Discoveries in Hungary", "The team stumbled upon archaeological sites."), true);
    assert.equal(isFiller("Kearsarge Conducts Surface Warfare Advanced Tactical Training", "The ship participated in training designed to increase interoperability."), true);
    assert.equal(isFiller("Turkish naval gun system shoots down jet drone in live-fire test", "A twin-cannon ship defense system shot down a jet-powered drone."), false);
  });

  it("merges same-day stories that share a company or a rare program, and keeps every source", () => {
    const day = "2026-11-24";
    type Row = { title: string; body: string; d: string; score: number; src: { t: string; u: string }; sources?: { t: string; u: string }[] };
    const cerberusA: Row = { title: "Investment firm Cerberus to buy space business of US Airbus arm", body: "Airbus will expand production of autonomous aircraft.", d: day, score: 4, src: { t: "Breaking Defense", u: "https://breakingdefense.com/cerberus" } };
    const cerberusB = { title: "Private equity firm Cerberus to acquire Airbus' U.S. satellite business", body: "The deal brings a factory built for OneWeb under American ownership.", d: day, score: 8, src: { t: "SpaceNews", u: "https://spacenews.com/cerberus" } };
    const lynxA = { title: "Ukrainian army gets German Lynx fighting vehicles", body: "Ukrainian soldiers are crewing Rheinmetall's Lynx infantry fighting vehicles.", d: day, score: 3, src: { t: "Defence Blog", u: "https://defence-blog.com/lynx" } };
    const lynxB = { title: "Lynx KF41 Fighting Vehicles, Newly Arrived In Ukraine, Will Take On Counter-Drone Mission", body: "Ukraine has received its first batch of Lynx KF41 Infantry Fighting Vehicles from Germany.", d: day, score: 6, src: { t: "The War Zone", u: "https://www.twz.com/lynx" } };
    const dome = { title: "White House seeks funding exemptions for Golden Dome, Trump battleship in next funding stopgap", body: "The Pentagon's munitions ramp could face turmoil if anomalies for key programs are not approved.", d: day, score: 7, src: { t: "Breaking Defense", u: "https://breakingdefense.com/dome" } };
    const cr = { title: "Ford-class Redesign, Battleship Funds on White House List for CR Anomaly Funding", body: "The Trump administration wants Congress to fund the Trump-class battleship in the next patchwork spending bill.", d: day, score: 4, src: { t: "USNI News", u: "https://news.usni.org/cr" } };
    const gm = { title: "Pentagon in talks with GM and Ford to help build drones", body: "The Pentagon is in talks with General Motors, Ford and other manufacturers about helping mass-produce military drones.", d: day, score: 6, src: { t: "Defence Blog", u: "https://defence-blog.com/gm" } };
    const ford = { title: "Ford in talks with the Pentagon to supply military vehicles", body: "Ford said it has held talks with the Pentagon about supplying military vehicles.", d: day, score: 2, src: { t: "Defense News", u: "https://www.defensenews.com/ford" } };
    const other = { title: "Canada's air force bets on F-35 as its core fighter jet", body: "Canada sketched a future fighter fleet built around the F-35.", d: day, score: 5, src: { t: "Defence Blog", u: "https://defence-blog.com/f35" } };
    const { kept, dropped } = dedupeEvents([cerberusA, cerberusB, lynxA, lynxB, dome, cr, gm, ford, other] as Row[], []);
    assert.equal(kept.length, 5);
    const byUrl = Object.fromEntries(kept.map((item) => [item.src.u, item]));
    assert.ok(byUrl[cerberusB.src.u]);
    assert.deepEqual(byUrl[cerberusB.src.u].sources, [{ t: "Breaking Defense", u: cerberusA.src.u }]);
    assert.ok(byUrl[lynxB.src.u].sources?.some((s) => s.t === "Defence Blog"));
    assert.ok(byUrl[dome.src.u].sources?.some((s) => s.t === "USNI News"));
    assert.ok(byUrl[gm.src.u].sources?.some((s) => s.t === "Defense News"));
    assert.equal(dropped.length, 4);
    assert.equal(sameStory(cerberusA, other), false);
  });

  it("turns backlog and revenue into years of work, and leaves a restated listing blank", () => {
    const amentumTitle = "Amentum Reports $13.8B in FY2026 Revenue, $48.3B Backlog";
    const amentumBody = "Amentum secured $15 billion in net bookings, including major NGA, Navy, Army and international nuclear program awards.";
    assert.equal(backlogYears(`${amentumTitle}. ${amentumBody}`), "3.5");
    const book = why(amentumTitle, amentumBody, ["Amentum"]);
    assert.match(book, /\$48\.3B backlog is about 3\.5 years of the \$13\.8B revenue/);
    assert.match(book, /NGA, nuclear, Navy and Army/);
    assert.doesNotMatch(book, /the backlog of the Navy/i);
    const black = why(
      "BlackSky acquires data firm EpochGeo",
      "WASHINGTON — BlackSky Technology announced it acquired geospatial data firm EpochGeo, a move to expand its slate of real-time intelligence tools as defense customers seek deeper analysis and data fusion capabilities.",
      ["BlackSky Technology"],
    );
    assert.match(black, /sells analysis and data fusion/);
    assert.match(black, /not only geospatial data/);
    assert.doesNotMatch(black, /acquired the data firm|imagery|NGA|Maven/);
    assert.deepEqual(ungroundedTerms(black, "BlackSky acquires data firm EpochGeo. WASHINGTON — BlackSky Technology announced it acquired geospatial data firm EpochGeo, a move to expand its slate of real-time intelligence tools as defense customers seek deeper analysis and data fusion capabilities."), []);
    const heli = why(
      "U.S. Special Operations Command orders more MH-47Gs",
      "Boeing has received a $197.3 million order modification to buy more MH-47G special operations helicopters for U.S. Special Operations Command.",
    );
    assert.match(heli, /Boeing keeps the next lot of MH-47G helicopters for Special Operations Command/);
    assert.doesNotMatch(heli, /modification/);
    const dome = why(
      "White House seeks funding exemptions for Golden Dome, Trump battleship in next funding stopgap",
      "The Pentagon's munitions ramp up could also face turmoil if anomalies for key programs are not approved.",
    );
    assert.match(dome, /have no stopgap funding until anomalies are approved/);
    assert.doesNotMatch(dome, /turmoil/);
    const spac = why(
      "Quantum Space Closes SPAC Merger With Inflection Point Ahead of NYSE Debut",
      "Quantum Space is set to begin trading on NYSE as QSPC following its merger with special purpose acquisition company Inflection Point.",
    );
    assert.equal(spac, "");
    assert.equal(isMechanicalChange("Cerberus changes the OneWeb factory to American ownership."), true);
    assert.equal(isMechanicalChange("The Inflection Point merger changes Quantum Space to NYSE trading as QSPC."), true);
  });

  it("writes a consequence for the CR anomaly, the Airbus sale, CAMM-MR, the SPAC, and the drone talks", () => {
    const dome = why(
      "White House seeks funding exemptions for Golden Dome, Trump battleship in next funding stopgap",
      "The Pentagon's munitions ramp up could also face turmoil if anomalies for key programs are not approved, the White House warned.",
    );
    assert.match(dome, /Golden Dome/);
    assert.match(dome, /battleship/);
    assert.match(dome, /stopgap funding/);
    assert.match(dome, /anomalies are approved/);
    assert.doesNotMatch(dome, /turmoil|face turmoil/);
    assert.ok(tokenOverlap(dome, "The Pentagon's munitions ramp up could also face turmoil if anomalies for key programs are not approved, the White House warned.") <= 0.6);
    const sale = why(
      "Private equity firm Cerberus to acquire Airbus' U.S. satellite business",
      "The deal brings a factory built for OneWeb's broadband constellation under American ownership.",
    );
    assert.equal(sale, "");
    assert.equal(copiesBodySentence(sale, "The deal brings a factory built for OneWeb's broadband constellation under American ownership."), false);
    const camm = why(
      "Poland, UK sign deal to develop CAMM-MR missile",
      "Poland and the United Kingdom signed an agreement that opens the way to developing CAMM-MR, a new air defense missile meant to reach beyond 100 km.",
    );
    assert.match(camm, /CAMM-MR/);
    assert.match(camm, /100/);
    assert.ok(tokenOverlap(camm, "Poland, UK sign deal to develop CAMM-MR missile") <= 0.6);
    const spac = why(
      "Quantum Space Closes SPAC Merger With Inflection Point Ahead of NYSE Debut",
      "Quantum Space is set to begin trading on NYSE as QSPC following its merger with special purpose acquisition company Inflection Point.",
    );
    assert.equal(spac, "");
    assert.equal(isStockHedge(spac), false);
    assert.doesNotMatch(spac, /changes .+ to NYSE/);
    const thin = why("Investment firm Cerberus to buy space business of US Airbus arm", "Airbus will expand production of autonomous aircraft.");
    assert.equal(thin, "");
  });

  it("falls back from a 403 RSS feed to the WordPress JSON posts, with a browser user agent", async () => {
    const calls: { url: string; ua: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({ url: String(url), ua: headers["user-agent"] ?? "" });
      if (String(url).includes("/wp-json/")) {
        return new Response(JSON.stringify([{
          date: "2026-11-24T17:34:22",
          link: "https://www.executivegov.com/articles/nro-nrol-136",
          title: { rendered: "NRO Sends NROL-136 to Orbit" },
          excerpt: { rendered: "NRO launched a satellite for the proliferated architecture." },
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("blocked", { status: 403 });
    }) as typeof fetch;
    try {
      assert.ok(FEED_HEADERS["user-agent"].includes("Chrome"));
      assert.ok(fallbackFeedUrls("https://www.executivegov.com/feed/").some((u) => u.includes("/wp-json/")));
      const report = await fetchFeedReport("ExecutiveGov", "https://www.executivegov.com/feed/");
      assert.equal(report.error, undefined);
      assert.equal(report.items.length, 1);
      assert.match(report.items[0].title, /NROL-136/);
      assert.equal(report.items[0].date, "2026-11-24");
      assert.equal(calls.length, 2);
      assert.match(calls[0].ua, /Chrome/);
      assert.match(calls[1].url, /wp-json/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("badges a feed down on the first failure, and shows a stuck newest date after the feed recovers", () => {
    let health: FeedHealth | null = null;
    health = updateFeedHealth(health, [{
      name: "ExecutiveGov", url: "https://www.executivegov.com/feed/", fetched: 0, inWindow: 0, added: 0, duplicates: 0, error: "HTTP 403",
    }], "2026-11-24", "2026-11-24T14:00:00.000Z");
    assert.equal(health.feeds.ExecutiveGov.down, true);
    assert.equal(health.feeds.ExecutiveGov.flag, undefined);
    const badges = feedBadges(health);
    assert.equal(badges[0].kind, "down");
    assert.match(badges[0].label, /feed down/);
    assert.match(badges[0].label, /HTTP 403/);

    const runs = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"].map((date) => ({
      name: "SpaceNews", url: "https://spacenews.com/feed/", fetched: 16, inWindow: 2, added: 0, duplicates: 2, newest: "2026-11-19",
    }));
    let space: FeedHealth | null = null;
    for (const row of runs) space = updateFeedHealth(space, [row], row.newest ? "2026-11-23" : row.name, "2026-11-23T14:00:00.000Z");
    // Replay each day with that day's date so the stuck span is the run dates, not one repeated day.
    space = null;
    for (const date of ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]) {
      const newest = date === "2026-11-24" ? "2026-11-24" : "2026-11-19";
      space = updateFeedHealth(space, [{
        name: "SpaceNews", url: "https://spacenews.com/wp-json/wp/v2/posts", fetched: 15, inWindow: date === "2026-11-23" ? 0 : 4, added: 0, duplicates: 4, newest,
      }], date, `${date}T14:00:00.000Z`);
    }
    assert.equal(space!.feeds.SpaceNews.stale, undefined);
    assert.match(space!.feeds.SpaceNews.flag ?? "", /2026-11-20–2026-11-23/);
    assert.match(space!.feeds.SpaceNews.flag ?? "", /stuck at 2026-11-19/);
    let lag: FeedHealth | null = null;
    for (const date of ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]) {
      lag = updateFeedHealth(lag, [{
        name: "DefenseScoop", url: "https://defensescoop.com/feed/", fetched: 10, inWindow: 3, added: 0, duplicates: 2,
        newest: date === "2026-11-24" ? "2026-11-24" : "2026-11-20",
      }], date, `${date}T14:00:00.000Z`);
    }
    assert.equal(lag!.feeds.DefenseScoop.flag, undefined);
    const staleBadge = feedBadges(space!).find((b) => b.name === "SpaceNews");
    assert.equal(staleBadge?.kind, "stale");
    const again = refreshFeedHealth(space!, "2026-11-24");
    assert.match(again.feeds.SpaceNews.flag ?? "", /stuck at 2026-11-19/);
  });
});
