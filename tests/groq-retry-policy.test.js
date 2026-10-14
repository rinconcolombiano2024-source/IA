"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  parseRetryAfter,
  backoffDelay,
  getGroqRetryDecision
}=require("../src/providers/groq/retry-policy");

test("Groq Retry-After parser supports seconds and HTTP dates",()=>{
  assert.equal(parseRetryAfter("2",0),2000);
  assert.equal(parseRetryAfter("bad",0),null);
  const now=Date.parse("2026-10-14T00:00:00Z");
  assert.equal(parseRetryAfter("Wed, 14 Oct 2026 00:00:03 GMT",now),3000);
});

test("Groq exponential backoff is bounded",()=>{
  assert.equal(backoffDelay(0,()=>0.5),750);
  assert.equal(backoffDelay(1,()=>0.5),1500);
  assert.ok(backoffDelay(8,()=>1)<=72000);
});

test("Groq retry policy handles rate, Flex capacity and transient server errors",()=>{
  assert.equal(getGroqRetryDecision({status:408,random:()=>0.5}).retry,true);
  assert.equal(getGroqRetryDecision({status:429,random:()=>0.5}).retry,true);
  assert.equal(getGroqRetryDecision({status:498,random:()=>0.5}).retry,true);
  assert.equal(getGroqRetryDecision({status:500,random:()=>0.5}).retry,true);

  for(const status of [400,401,403,404,405,413,415,422]){
    assert.equal(getGroqRetryDecision({status}).retry,false,String(status));
  }
});
