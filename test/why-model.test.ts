import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { acceptModelWhy, polishWhys, whyModel } from "../src/why.ts";

const KEYS = ["GROQ_API_KEY", "OLLAMA_MODEL", "OLLAMA_HOST", "WHY_MODEL_TIMEOUT_MS"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(vars: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("why-line model", () => {
  it("uses no model when neither Groq nor Ollama is configured", () => {
    setEnv({});
    assert.equal(whyModel(), null);
  });

  it("prefers Groq when a key is set, even if Ollama is also configured", () => {
    setEnv({ GROQ_API_KEY: "test-key", OLLAMA_MODEL: "qwen3.5:4b" });
    const model = whyModel();
    assert.equal(model?.id, "groq");
    assert.equal(model?.apiKey, "test-key");
  });

  it("uses Ollama when only OLLAMA_MODEL or OLLAMA_HOST is set", () => {
    setEnv({ OLLAMA_MODEL: "qwen3.5:4b" });
    assert.equal(whyModel()?.id, "ollama");
    assert.equal(whyModel()?.model, "qwen3.5:4b");
    setEnv({ OLLAMA_HOST: "http://127.0.0.1:11434" });
    assert.equal(whyModel()?.id, "ollama");
  });

  it("rejects empty, short, garbage, and near-copies of the summary", () => {
    const summary = "A French-supplied Mirage 2000 fighter shot down a Russian jet-powered attack drone with its built-in cannon.";
    assert.equal(acceptModelWhy("", summary), false);
    assert.equal(acceptModelWhy("Too short to be a so-what.", summary), false);
    assert.equal(acceptModelWhy("aaaaaaaaaa this is long enough to pass a length check but it is garbage text!!!!", summary), false);
    assert.equal(acceptModelWhy(summary, summary), false);
    assert.equal(
      acceptModelWhy(
        "Air forces will buy cannon cueing and ammunition, because a gun round just beat a missile against a jet drone.",
        summary,
      ),
      true,
    );
  });

  it("leaves the rule-based line in place when no model is configured", async () => {
    setEnv({});
    const items = [{ id: "a", title: "t", body: "A long enough summary about a drone buy.", why: "Rule line that stays.", sector: "air" }];
    await polishWhys(items);
    assert.equal(items[0].why, "Rule line that stays.");
  });

  it("applies a concrete model line and rejects a near-copy, with thinking off", async () => {
    setEnv({ OLLAMA_MODEL: "qwen3.5:4b", OLLAMA_HOST: "http://127.0.0.1:9" });
    const summary = "A French-supplied Mirage 2000 fighter shot down a Russian jet-powered attack drone with its built-in cannon.";
    const bodies: unknown[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const content = JSON.stringify({
        lines: [
          { id: "good", why: "Air forces will buy cannon cueing and ammunition, because a gun round just beat a missile against a jet drone." },
          { id: "copy", why: summary },
          { id: "junk", why: "aaaaaaaaaa this is long enough to pass a length check but it is garbage text!!!!" },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
    };
    try {
      const items = [
        { id: "good", title: "Mirage", body: summary, why: "Rule line that stays.", sector: "air" },
        { id: "copy", title: "Mirage", body: summary, why: "Rule line that stays.", sector: "air" },
        { id: "junk", title: "Mirage", body: summary, why: "Rule line that stays.", sector: "air" },
      ];
      await polishWhys(items);
      const sent = bodies[0] as { reasoning_effort?: string; response_format?: { type?: string } };
      assert.equal(sent.reasoning_effort, "none");
      assert.equal(sent.response_format?.type, "json_object");
      assert.equal(items[0].why, "Air forces will buy cannon cueing and ammunition, because a gun round just beat a missile against a jet drone.");
      assert.equal(items[1].why, "Rule line that stays.");
      assert.equal(items[2].why, "Rule line that stays.");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("leaves the rule-based line in place when the model call fails", async () => {
    setEnv({ OLLAMA_HOST: "http://127.0.0.1:1", OLLAMA_MODEL: "qwen3.5:4b", WHY_MODEL_TIMEOUT_MS: "1500" });
    const items = [{ id: "a", title: "t", body: "A long enough summary about a drone buy for the army.", why: "Rule line that stays.", sector: "air" }];
    await polishWhys(items);
    assert.equal(items[0].why, "Rule line that stays.");
  });
});
