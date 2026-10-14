"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  parseRetryAfter,
  backoffDelay,
  getXaiRetryDecision
}=require("../src/providers/xai/retry-policy");

test("xAI Retry-After parser supports seconds and HTTP dates",()=>{
  assert.equal(parseRetryAfter("2",0),2000);
  assert.equal(parseRetryAfter("bad",0),null);
  const now=Date.parse("2026-10-14T00:00:00Z");
  assert.equal(parseRetryAfter("Wed, 14 Oct 2026 00:00:03 GMT",now),3000);
});

test("xAI exponential backoff is bounded",()=>{
  assert.equal(backoffDelay(0,()=>0.5),1000);
  assert.equal(backoffDelay(1,()=>0.5),2000);
  assert.ok(backoffDelay(8,()=>1)<=72000);
});

test("xAI current retry guidance is encoded",()=>{
  assert.equal(getXaiRetryDecision({status:408,random:()=>0.5}).retry,true);
  assert.equal(getXaiRetryDecision({status:429,random:()=>0.5}).retry,true);
  assert.equal(getXaiRetryDecision({status:500,random:()=>0.5}).retry,true);
  assert.equal(getXaiRetryDecision({status:503,random:()=>0.5}).retry,true);

  for(const status of [400,401,403,404,405,415,422]){
    assert.equal(getXaiRetryDecision({status}).retry,false,String(status));
  }
});
