"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  parseRetryAfter,
  backoffDelay,
  getAnthropicRetryDecision
}=require("../src/providers/anthropic/retry-policy");

test("Anthropic Retry-After parser supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("2",0),2000);
  assert.equal(parseRetryAfter("bad",0),null);
  const now=Date.parse("2026-10-14T00:00:00Z");
  assert.equal(
    parseRetryAfter("Wed, 14 Oct 2026 00:00:03 GMT",now),
    3000
  );
});

test("Anthropic backoff is bounded and deterministic with injected randomness", () => {
  assert.equal(backoffDelay(0,()=>0.5),800);
  assert.equal(backoffDelay(1,()=>0.5),1600);
  assert.ok(backoffDelay(8,()=>1)<=36000);
});

test("Anthropic retry policy classifies transient and terminal failures", () => {
  assert.equal(getAnthropicRetryDecision({status:400}).retry,false);
  assert.equal(getAnthropicRetryDecision({status:401}).retry,false);
  assert.equal(getAnthropicRetryDecision({status:408,attempt:0,random:()=>0.5}).retry,true);
  assert.equal(getAnthropicRetryDecision({status:409,attempt:0,random:()=>0.5}).retry,true);
  assert.equal(getAnthropicRetryDecision({status:500,attempt:0,random:()=>0.5}).retry,true);
  assert.equal(getAnthropicRetryDecision({status:529,attempt:0,random:()=>0.5}).retry,true);
  assert.equal(getAnthropicRetryDecision({
    status:429,
    errorCode:"enforced_spend_limit_reached"
  }).retry,false);
  assert.equal(getAnthropicRetryDecision({
    status:500,
    shouldRetry:"false"
  }).retry,false);
});
