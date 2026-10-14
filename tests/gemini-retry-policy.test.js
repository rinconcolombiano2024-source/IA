"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  parseRetryAfter,
  backoffDelay,
  getGeminiRetryDecision
}=require("../src/providers/gemini/retry-policy");

test("Gemini Retry-After parser supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("2",0),2000);
  assert.equal(parseRetryAfter("bad",0),null);
  const now=Date.parse("2026-10-14T00:00:00Z");
  assert.equal(parseRetryAfter("Wed, 14 Oct 2026 00:00:03 GMT",now),3000);
});

test("Gemini backoff follows exponential progression with jitter", () => {
  assert.equal(backoffDelay(0,()=>0.5),1000);
  assert.equal(backoffDelay(1,()=>0.5),2000);
  assert.ok(backoffDelay(8,()=>1)<=72000);
});

test("Gemini retry decisions match current transient error guidance", () => {
  assert.equal(getGeminiRetryDecision({status:408,random:()=>0.5}).retry,true);
  assert.equal(getGeminiRetryDecision({status:429,random:()=>0.5}).retry,true);
  assert.equal(getGeminiRetryDecision({status:500,random:()=>0.5}).retry,true);
  assert.equal(getGeminiRetryDecision({status:503,random:()=>0.5}).retry,true);

  for(const status of [400,401,402,403,404,416]){
    assert.equal(getGeminiRetryDecision({status}).retry,false,String(status));
  }
});
