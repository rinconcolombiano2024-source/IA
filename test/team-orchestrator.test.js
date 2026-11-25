"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { orchestrate } = require("../src/core/team-orchestrator");
const selections = [{provider:"openai",id:"a"},{provider:"gemini",id:"b"},{provider:"anthropic",id:"c"},{provider:"deepseek",id:"d"},{provider:"groq",id:"e"}];
test("requires at least two different providers", async () => {
  assert.deepEqual(await orchestrate({mode:"team",prompt:"x",selections:[selections[0],selections[0]],generate:()=>{throw Error("unexpected");}}),{unavailable:true});
});
test("compare limits provider fanout and does not synthesize", async () => {
  let calls=0;
  const result=await orchestrate({mode:"compare",prompt:"x",selections,generate:async()=>{calls++;return "answer";}});
  assert.equal(calls,4);assert.equal(result.contributions.length,4);assert.equal(result.synthesis,null);assert.equal(result.partial,false);
});
test("team keeps partial results and prefers OpenAI synthesis", async () => {
  let calls=0;
  const result=await orchestrate({mode:"team",prompt:"x",selections,generate:async(s)=>{calls++;if(s.provider==="gemini")throw Error("failure");return "answer";}});
  assert.equal(calls,5);assert.equal(result.synthesis.provider,"openai");assert.equal(result.partial,true);
  assert.equal(result.contributions.find(c=>c.provider==="gemini").status,"error");
});
test("failed synthesis preserves successful individual answers", async () => {
  let calls=0;
  const result=await orchestrate({mode:"team",prompt:"x",selections:selections.slice(0,2),generate:async()=>{if(++calls===3)throw Error("failure");return "ok";}});
  assert.equal(result.synthesis,null);assert.equal(result.partial,true);assert.equal(result.contributions.filter(c=>c.status==="ok").length,2);
});
