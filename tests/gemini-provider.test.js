"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProviderAdapter } = require("../src/providers/provider-contract");
const { createProviderRegistry } = require("../src/providers/registry");
const { createOpenAIProvider } = require("../src/providers/openai/provider");
const { createAnthropicProvider } = require("../src/providers/anthropic/provider");
const { createGeminiProvider } = require("../src/providers/gemini/provider");
const { createModelRegistry } = require("../src/models/model-registry");
const { createModelRouter } = require("../src/core/model-router");

function fakeResponse({status,body={},headers={}}) {
  const normalized=Object.fromEntries(
    Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)])
  );
  return {
    status,
    ok:status>=200&&status<300,
    headers:{get(name){return normalized[String(name).toLowerCase()]||null;}},
    clone(){return {async json(){return body;}};},
    async json(){return body;}
  };
}

test("Gemini adapter satisfies universal provider contract", () => {
  const provider=createGeminiProvider({env:{GEMINI_API_KEY:"test-key"}});
  assertProviderAdapter(provider);
  assert.equal(provider.isConfigured(),true);
  assert.equal(provider.supports("text"),true);
  assert.equal(provider.supports("images"),false);
});

test("Gemini text request uses native generateContent shape and model endpoint params", () => {
  const provider=createGeminiProvider({
    env:{
      GEMINI_API_KEY:"test-key",
      GEMINI_TEXT_MODEL:"gemini-3.8-flash",
      GEMINI_MAX_OUTPUT_TOKENS:"4096"
    }
  });

  const request=provider.buildTextRequest({
    model:"gemini-3.8-flash",
    instructions:"system",
    input:"hello"
  });

  assert.equal(request.endpointName,"generate_content");
  assert.deepEqual(request.endpointParams,{model:"gemini-3.8-flash"});
  assert.deepEqual(request.payload,{
    contents:[{role:"user",parts:[{text:"hello"}]}],
    generationConfig:{maxOutputTokens:4096},
    systemInstruction:{parts:[{text:"system"}]}
  });
});

test("Gemini structured request uses current responseFormat text schema", () => {
  const provider=createGeminiProvider({env:{GEMINI_API_KEY:"test-key"}});
  const schema={
    type:"object",
    additionalProperties:false,
    properties:{answer:{type:"string"}},
    required:["answer"]
  };

  const request=provider.buildStructuredRequest({
    model:"gemini-3.8-flash",
    input:"hello",
    schema
  });

  assert.deepEqual(request.payload.generationConfig.responseFormat,{
    text:{
      mimeType:"APPLICATION_JSON",
      schema
    }
  });
});

test("Gemini endpoints keep model identifiers encoded and API key in headers", () => {
  const provider=createGeminiProvider({
    env:{
      GEMINI_API_KEY:"secret-gemini-key",
      GEMINI_API_CLIENT:"rincon-colombiano-ia/2.0.0"
    }
  });

  assert.equal(
    provider.endpoint("generate_content",{model:"gemini-3.8-flash"}),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
  );
  const headers=provider.authHeaders({"Content-Type":"application/json"});
  assert.equal(headers["x-goog-api-key"],"secret-gemini-key");
  assert.equal(headers["x-goog-api-client"],"rincon-colombiano-ia/2.0.0");
  assert.equal(JSON.stringify(provider.publicSummary()).includes("secret-gemini-key"),false);
});

test("Gemini extraction omits thought parts and joins visible text", () => {
  const provider=createGeminiProvider({env:{GEMINI_API_KEY:"test-key"}});
  assert.equal(provider.extractText({
    candidates:[
      {content:{parts:[
        {text:"hidden",thought:true},
        {text:"one"},
        {text:"two"}
      ]}}
    ]
  }),"one\ntwo");
});

test("Gemini retry policy retries transient failures but not payment or permission errors", async () => {
  const provider=createGeminiProvider({env:{GEMINI_API_KEY:"test-key"}});

  const rate=await provider.retryDecision({
    response:fakeResponse({
      status:429,
      body:{error:{status:"RESOURCE_EXHAUSTED"}},
      headers:{"retry-after":"2"}
    }),
    attempt:0
  });
  assert.equal(rate.retry,true);
  assert.equal(rate.delayMs,2000);

  for(const status of [400,401,402,403]){
    const decision=await provider.retryDecision({
      response:fakeResponse({status}),
      attempt:0
    });
    assert.equal(decision.retry,false,String(status));
  }
});

test("Gemini model discovery uses native Models API and captures context metadata", async () => {
  const calls=[];
  const provider=createGeminiProvider({
    env:{
      GEMINI_API_KEY:"secret-key",
      GEMINI_TEXT_MODEL:"gemini-3.8-flash"
    }
  });

  const models=await provider.discoverModels({
    fetchImpl:async (url,init)=>{
      calls.push({url,init});
      return fakeResponse({
        status:200,
        body:{
          models:[
            {
              name:"models/gemini-3.8-flash",
              baseModelId:"gemini-3.8-flash",
              version:"3.8",
              displayName:"Gemini 3.8 Flash",
              inputTokenLimit:1048576,
              outputTokenLimit:65536,
              supportedGenerationMethods:["generateContent"]
            }
          ]
        }
      });
    }
  });

  assert.equal(models.length,1);
  assert.equal(models[0].id,"gemini-3.8-flash");
  assert.equal(models[0].contextWindow,1048576);
  assert.equal(models[0].metadata.outputTokenLimit,65536);
  assert.match(calls[0].url,/\/v1beta\/models\?pageSize=1000/);
  assert.equal(calls[0].init.headers["x-goog-api-key"],"secret-key");
});

test("router preserves OpenAI then Anthropic then Gemini priority order", () => {
  const openai=createOpenAIProvider({
    env:{OPENAI_API_KEY:"openai-key",OPENAI_TEXT_MODEL:"gpt-text"}
  });
  const anthropic=createAnthropicProvider({
    env:{ANTHROPIC_API_KEY:"anthropic-key",ANTHROPIC_TEXT_MODEL:"claude-sonnet-5-5"}
  });
  const gemini=createGeminiProvider({
    env:{GEMINI_API_KEY:"gemini-key",GEMINI_TEXT_MODEL:"gemini-3.8-flash"}
  });

  const providers=createProviderRegistry([openai,anthropic,gemini]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});
  const plan=router.plan({capability:"text"});

  assert.equal(plan.primary.provider,"openai");
  assert.equal(plan.fallback.provider,"anthropic");
  assert.equal(plan.secondFallback.provider,"gemini");
});

test("router can select Gemini when it is the only configured text provider", () => {
  const openai=createOpenAIProvider({env:{}});
  const anthropic=createAnthropicProvider({env:{}});
  const gemini=createGeminiProvider({env:{GEMINI_API_KEY:"gemini-key"}});
  const providers=createProviderRegistry([openai,anthropic,gemini]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});

  assert.equal(router.plan({capability:"text"}).primary.provider,"gemini");
  assert.equal(router.plan({capability:"code"}).primary.provider,"gemini");
  assert.equal(router.plan({capability:"structured_json"}).primary.provider,"gemini");
});
