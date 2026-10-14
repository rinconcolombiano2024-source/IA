"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {assertProviderAdapter}=require("../src/providers/provider-contract");
const {createProviderRegistry}=require("../src/providers/registry");
const {createOpenAIProvider}=require("../src/providers/openai/provider");
const {createAnthropicProvider}=require("../src/providers/anthropic/provider");
const {createGeminiProvider}=require("../src/providers/gemini/provider");
const {createXaiProvider}=require("../src/providers/xai/provider");
const {createGroqProvider}=require("../src/providers/groq/provider");
const {createModelRegistry}=require("../src/models/model-registry");
const {createModelRouter}=require("../src/core/model-router");

function fakeResponse(status,headers={}){
  const normalized=Object.fromEntries(
    Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)])
  );
  return {
    status,
    ok:status>=200&&status<300,
    headers:{get(name){return normalized[String(name).toLowerCase()]||null;}}
  };
}

test("Groq adapter satisfies provider contract and uses Responses endpoint",()=>{
  const provider=createGroqProvider({env:{GROQ_API_KEY:"groq-key"}});
  assertProviderAdapter(provider);
  assert.equal(provider.endpoint("responses"),"https://api.groq.com/openai/v1/responses");
  assert.equal(provider.supports("structured_json"),true);
  assert.equal(provider.supports("images"),false);
});

test("Groq GPT-OSS 120B verified metadata is represented exactly",()=>{
  const provider=createGroqProvider({
    env:{GROQ_API_KEY:"key",GROQ_TEXT_MODEL:"openai/gpt-oss-120b"}
  });
  const model=provider.listModels()[0];
  assert.equal(model.contextWindow,131072);
  assert.equal(model.inputCostPerMillion,0.15);
  assert.equal(model.outputCostPerMillion,0.60);
  assert.equal(model.toolCompatible,true);
});

test("Groq retry honors retry-after and retries Flex capacity errors",async()=>{
  const provider=createGroqProvider({env:{GROQ_API_KEY:"key"}});
  const rate=await provider.retryDecision({
    response:fakeResponse(429,{"retry-after":"2"}),
    attempt:0
  });
  assert.equal(rate.retry,true);
  assert.equal(rate.delayMs,2000);

  const flex=await provider.retryDecision({
    response:fakeResponse(498),
    attempt:0
  });
  assert.equal(flex.retry,true);

  const bad=await provider.retryDecision({
    response:fakeResponse(400),
    attempt:0
  });
  assert.equal(bad.retry,false);
});

test("router adds Groq after existing default providers without regression",()=>{
  const providers=createProviderRegistry([
    createOpenAIProvider({env:{OPENAI_API_KEY:"a",OPENAI_TEXT_MODEL:"gpt"}}),
    createAnthropicProvider({env:{ANTHROPIC_API_KEY:"b",ANTHROPIC_TEXT_MODEL:"claude"}}),
    createGeminiProvider({env:{GEMINI_API_KEY:"c",GEMINI_TEXT_MODEL:"gemini-3.8-flash"}}),
    createXaiProvider({env:{XAI_API_KEY:"d",XAI_TEXT_MODEL:"grok-4.7"}}),
    createGroqProvider({env:{GROQ_API_KEY:"e",GROQ_TEXT_MODEL:"openai/gpt-oss-120b"}})
  ]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});
  const plan=router.plan({capability:"text"});

  assert.deepEqual(
    plan.candidates.slice(0,5).map((model)=>model.provider),
    ["openai","anthropic","gemini","xai","groq"]
  );
});

test("Groq becomes primary when it is the only configured provider",()=>{
  const provider=createGroqProvider({env:{GROQ_API_KEY:"e"}});
  const providers=createProviderRegistry([provider]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});

  assert.equal(router.plan({capability:"text"}).primary.provider,"groq");
  assert.equal(router.plan({capability:"code"}).primary.provider,"groq");
});
