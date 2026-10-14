"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProviderAdapter } = require("../src/providers/provider-contract");
const { createProviderRegistry } = require("../src/providers/registry");
const { createOpenAIProvider } = require("../src/providers/openai/provider");
const { createAnthropicProvider } = require("../src/providers/anthropic/provider");
const { createModelRegistry } = require("../src/models/model-registry");
const { createModelRouter } = require("../src/core/model-router");

function fakeResponse({status,body={},headers={}}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key,value]) => [key.toLowerCase(),String(value)])
  );
  return {
    status,
    ok:status >= 200 && status < 300,
    headers:{
      get(name){ return normalized[String(name).toLowerCase()] || null; }
    },
    clone(){
      return {async json(){ return body; }};
    },
    async json(){ return body; }
  };
}

test("Anthropic adapter satisfies universal provider contract", () => {
  const provider=createAnthropicProvider({env:{ANTHROPIC_API_KEY:"test-key"}});
  assertProviderAdapter(provider);
  assert.equal(provider.isConfigured(),true);
  assert.equal(provider.supports("text"),true);
  assert.equal(provider.supports("images"),false);
});

test("Anthropic text request uses current Messages API shape", () => {
  const provider=createAnthropicProvider({
    env:{
      ANTHROPIC_API_KEY:"test-key",
      ANTHROPIC_TEXT_MODEL:"claude-sonnet-5-5",
      ANTHROPIC_MAX_TOKENS:"2048"
    }
  });

  const request=provider.buildTextRequest({
    model:"claude-sonnet-5-5",
    instructions:"system",
    input:"hello"
  });

  assert.equal(request.endpointName,"messages");
  assert.deepEqual(request.payload,{
    model:"claude-sonnet-5-5",
    max_tokens:2048,
    messages:[{role:"user",content:"hello"}],
    system:"system"
  });
});

test("Anthropic structured request uses output_config.format JSON schema", () => {
  const provider=createAnthropicProvider({env:{ANTHROPIC_API_KEY:"test-key"}});
  const schema={
    type:"object",
    additionalProperties:false,
    properties:{answer:{type:"string"}},
    required:["answer"]
  };

  const request=provider.buildStructuredRequest({
    model:"claude-sonnet-5-5",
    input:"hello",
    schemaName:"answer_schema",
    schema
  });

  assert.equal(request.payload.output_config.format.type,"json_schema");
  assert.deepEqual(request.payload.output_config.format.schema,schema);
});

test("Anthropic auth and extraction are provider-owned and secrets stay private", () => {
  const provider=createAnthropicProvider({
    env:{
      ANTHROPIC_API_KEY:"secret-anthropic-key",
      ANTHROPIC_VERSION:"2023-06-01"
    }
  });

  assert.deepEqual(provider.authHeaders({"Content-Type":"application/json"}),{
    Authorization:"Bearer secret-anthropic-key",
    "anthropic-version":"2023-06-01",
    "Content-Type":"application/json"
  });
  assert.equal(provider.extractText({
    content:[
      {type:"text",text:"one"},
      {type:"thinking",thinking:"hidden"},
      {type:"text",text:"two"}
    ]
  }),"one\ntwo");
  assert.equal(JSON.stringify(provider.publicSummary()).includes("secret-anthropic-key"),false);
});

test("Anthropic retry policy does not retry enforced spend caps", async () => {
  const provider=createAnthropicProvider({env:{ANTHROPIC_API_KEY:"test-key"}});
  const decision=await provider.retryDecision({
    response:fakeResponse({
      status:429,
      body:{error:{details:{error_code:"enforced_spend_limit_reached"}}}
    }),
    attempt:0
  });
  assert.equal(decision.retry,false);
});

test("Anthropic retry policy honors retry-after and retries overloaded responses", async () => {
  const provider=createAnthropicProvider({env:{ANTHROPIC_API_KEY:"test-key"}});
  const rate=await provider.retryDecision({
    response:fakeResponse({
      status:429,
      headers:{"retry-after":"2"}
    }),
    attempt:0
  });
  assert.equal(rate.retry,true);
  assert.equal(rate.delayMs,2000);

  const overloaded=await provider.retryDecision({
    response:fakeResponse({status:529}),
    attempt:0
  });
  assert.equal(overloaded.retry,true);
});

test("Anthropic model discovery uses Models API without exposing credentials", async () => {
  const calls=[];
  const provider=createAnthropicProvider({
    env:{
      ANTHROPIC_API_KEY:"secret-key",
      ANTHROPIC_TEXT_MODEL:"claude-sonnet-5-5"
    }
  });

  const models=await provider.discoverModels({
    fetchImpl:async (url,init) => {
      calls.push({url,init});
      return fakeResponse({
        status:200,
        body:{
          data:[
            {
              id:"claude-sonnet-5-5",
              lifecycle:"active",
              display_name:"Claude Sonnet 5.5",
              capabilities:{thinking:{supported:true}}
            },
            {
              id:"claude-haiku-5-5",
              lifecycle:"active",
              display_name:"Claude Haiku 5.5"
            }
          ]
        }
      });
    }
  });

  assert.equal(models.length,2);
  assert.equal(models[0].provider,"anthropic");
  assert.ok(models[0].capabilities.includes("structured_json"));
  assert.match(calls[0].url,/\/v1\/models\?/);
  assert.equal(calls[0].init.headers.Authorization,"Bearer secret-key");
});

test("router preserves OpenAI primary and adds Anthropic fallback when both are configured", () => {
  const openai=createOpenAIProvider({
    env:{OPENAI_API_KEY:"openai-key",OPENAI_TEXT_MODEL:"gpt-text"}
  });
  const anthropic=createAnthropicProvider({
    env:{ANTHROPIC_API_KEY:"anthropic-key",ANTHROPIC_TEXT_MODEL:"claude-sonnet-5-5"}
  });
  const providers=createProviderRegistry([openai,anthropic]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});
  const plan=router.plan({capability:"text"});

  assert.equal(plan.primary.provider,"openai");
  assert.equal(plan.fallback.provider,"anthropic");
});

test("router selects Anthropic when it is the only configured text provider", () => {
  const openai=createOpenAIProvider({env:{}});
  const anthropic=createAnthropicProvider({
    env:{ANTHROPIC_API_KEY:"anthropic-key",ANTHROPIC_TEXT_MODEL:"claude-sonnet-5-5"}
  });
  const providers=createProviderRegistry([openai,anthropic]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});

  assert.equal(router.plan({capability:"text"}).primary.provider,"anthropic");
  assert.equal(router.plan({capability:"code"}).primary.provider,"anthropic");
  assert.equal(router.plan({capability:"structured_json"}).primary.provider,"anthropic");
});
