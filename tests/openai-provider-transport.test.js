"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createOpenAIProvider,
  normalizeBaseUrl
} = require("../src/providers/openai/provider");

function fakeResponse({ status, body = {}, retryAfter = "" }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "retry-after" ? retryAfter : null;
      }
    },
    clone() {
      return {
        async json() {
          return body;
        }
      };
    }
  };
}

test("OpenAI transport endpoints are encapsulated in provider adapter", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-test" }});
  assert.equal(provider.endpoint("responses"), "https://api.openai.com/v1/responses");
  assert.equal(provider.endpoint("images"), "https://api.openai.com/v1/images/generations");
  assert.equal(provider.endpoint("videos"), "https://api.openai.com/v1/videos");
  assert.equal(provider.endpoint("video_status",{videoId:"a/b"}), "https://api.openai.com/v1/videos/a%2Fb");
  assert.equal(provider.endpoint("video_content",{videoId:"abc"}), "https://api.openai.com/v1/videos/abc/content");
});

test("OpenAI custom base URL is normalized and constrained to HTTPS", () => {
  assert.equal(normalizeBaseUrl("https://example.test/v1/"), "https://example.test/v1");
  assert.throws(() => normalizeBaseUrl("http://example.test/v1"));
  assert.throws(() => normalizeBaseUrl("https://user:pass@example.test/v1"));
});

test("OpenAI auth headers stay inside provider adapter", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-secret" }});
  assert.deepEqual(provider.authHeaders({"Content-Type":"application/json"}), {
    Authorization:"Bearer sk-secret",
    "Content-Type":"application/json"
  });
  const missing = createOpenAIProvider({ env:{} });
  assert.throws(() => missing.authHeaders());
});

test("OpenAI retry decision parses provider error payload internally", async () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-test" }});
  const quota = await provider.retryDecision({
    response:fakeResponse({
      status:429,
      body:{error:{type:"insufficient_quota",code:"insufficient_quota"}}
    }),
    attempt:0
  });
  assert.equal(quota.retry,false);

  const transient = await provider.retryDecision({
    response:fakeResponse({
      status:429,
      body:{error:{type:"rate_limit_error",code:"slow_down"}},
      retryAfter:"2"
    }),
    attempt:0
  });
  assert.equal(transient.retry,true);
  assert.ok(transient.delayMs >= 2000);
});

test("OpenAI provider owns network retry delay and public error parsing", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-test" }});
  assert.ok(provider.networkRetryDelay(0) >= 700);
  assert.equal(provider.errorMessage({error:{message:"boom"}}),"boom");
  assert.match(provider.errorMessage({}),/OpenAI/);
});
