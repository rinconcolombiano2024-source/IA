"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {answerUniversal,selectProviders,normalizeContext}=require("../src/core/universal-assistant");
const selections=["openai","gemini","anthropic","deepseek","xai","groq","new-provider"].map(provider=>({provider,id:"test"}));
test("deduplicates providers and includes future adapters within cap",()=>{
 assert.equal(selectProviders([...selections,selections[0]],7).length,7);
 assert.equal(selectProviders(selections,6).length,6);
 assert.equal(selectProviders(selections,1)[0].provider,"openai");
});
test("all six contribute to one synthesis; no individual texts exposed",async()=>{
 const calls=[];
 const r=await answerUniversal({prompt:"hola",selections,generate:async(s,i,p,phase)=>{calls.push({s,phase,p});return phase==="synthesis"?"final":"individual";}});
 assert.equal(calls.length,7);assert.equal(r.text,"final");assert.equal(r.succeeded,6);assert.equal(r.status,"synthesized");assert.equal(r.providers.some(p=>p.text),false);
 assert.equal(JSON.parse(calls[6].p).contributions.length,6);
});
test("partial providers, backup coordinator and honest metadata",async()=>{
 const r=await answerUniversal({prompt:"q",selections:selections.slice(0,3),generate:async(s,i,p,phase)=>{
  if(s.provider==="anthropic" || (s.provider==="openai" && phase==="synthesis"))throw Error("failure");
  return phase==="synthesis"?"combined":"draft";
 }});
 assert.equal(r.status,"partial");assert.equal(r.coordinator,"gemini");assert.equal(r.text,"combined");
});
test("one working provider and no available provider are distinct",async()=>{
 const r=await answerUniversal({prompt:"q",selections:selections.slice(0,2),generate:async(s)=>{if(s.provider==="gemini")throw Error();return "one";}});
 assert.equal(r.status,"single");assert.equal(r.text,"one");
 const none=await answerUniversal({prompt:"q",selections:[],generate:async()=>{throw Error();}});
 assert.equal(none.status,"unavailable");
});
test("synthesis timeout preserves one real answer",async()=>{
 const r=await answerUniversal({prompt:"q",selections:selections.slice(0,2),canSynthesize:()=>false,generate:async()=> "real"});
 assert.equal(r.status,"fallback");assert.equal(r.text,"real");
});
test("context bounded, invalid roles rejected",()=>{
 const c=normalizeContext([{role:"system",text:"bad"},{role:"user",text:"x".repeat(1600)}]);
 assert.equal(c.length,1);assert.equal(c[0].text.length,1500);
});
