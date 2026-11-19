import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefTitle, classify, storyWhy } from "../src/classify.ts";
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
    const line = why(c.sectors[0] ? "Tiny Albania gets green light to buy two HIMARS launchers" : "", "The U.S. State Department approved a $210 million sale of two M142 HIMARS launchers and their guided rockets.");
    assert.match(line, /HIMARS/);
    assert.match(line, /not a merger/);
    assert.doesNotMatch(line, /investors put money/i);
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
    assert.match(laser, /field/);
    assert.notEqual(laser, GENERIC_STRIKE);
  });

  it("says what the Navy hearing is about, not that the Navy wants unmanned boats", () => {
    const line = why(
      "Senate grills acting Navy secretary on Iran war costs, extended deployments",
      "The White House’s pick to lead the Navy didn’t have clear answers Tuesday when lawmakers pressed him about ballooning Iran war costs.",
    );
    assert.match(line, /Iran war costs/);
    assert.notEqual(line, GENERIC_SEA);
  });

  it("omits the line when the sector match is only a passing mention in the body", () => {
    const title = "Office picnic scheduled for Friday";
    const body = "A colleague mentioned the satellite photo in the newsletter.";
    const c = classify(title, body);
    assert.equal(c.sectors[0]?.id, "space");
    assert.ok(c.sectors[0].titleScore < 4);
    assert.equal(storyWhy(title, body, c.sectors[0], c.type, []), "");
    assert.notEqual(storyWhy(title, body, c.sectors[0], c.type, []), GENERIC_SPACE);
  });

  it("does not use the old ground-robot line on the Morocco missile", () => {
    const line = why("Chinese anti-tank missile spotted in Morocco", "Officer cadets fired a Chinese HJ-9A anti-tank missile from a Humvee.");
    assert.notEqual(line, GENERIC_GROUND);
    assert.match(line, /anti-tank/i);
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
