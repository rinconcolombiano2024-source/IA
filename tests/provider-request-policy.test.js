"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenAIProvider, normalizeInteger } = require("../src/providers/openai/provider");

test("provider request policy owns timeout and retry configuration", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_TIMEOUT_MS:"45000",
      OPENAI_MAX_RETRIES:"4"
    }
  });

  assert.deepEqual(provider.requestPolicy(),{
    timeoutMs:45000,
    maxRetries:4
  });
});

test("OpenAI request policy uses safe bounded defaults", () => {
  const defaults=createOpenAIProvider({env:{OPENAI_API_KEY:"sk-test"}});
  assert.deepEqual(defaults.requestPolicy(),{
    timeoutMs:120000,
    maxRetries:2
  });

  const bounded=createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_TIMEOUT_MS:"999999999",
      OPENAI_MAX_RETRIES:"999"
    }
  });
  assert.equal(bounded.requestPolicy().timeoutMs,1800000);
  assert.equal(bounded.requestPolicy().maxRetries,5);
});

test("request policy normalization handles malformed values", () => {
  assert.equal(normalizeInteger("bad",10,1,20),10);
  assert.equal(normalizeInteger("-5",10,1,20),1);
  assert.equal(normalizeInteger("30",10,1,20),20);
});
