"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {assertProviderAdapter}=require("../src/providers/provider-contract");
const {createProviderRegistry}=require("../src/providers/registry");
const {createOpenAIProvider}=require("../src/providers/openai/provider");
const {createAnthropicProvider}=require("../src/providers/anthropic/provider");
const {createGeminiProvider}=require("../src/providers/gemini/provider");
const {createXaiProvider}=require("../src/providers/xai/provider");
const {createModelRegistry}=require("../src/models/model-registry");
const {createModelRouter}=require("../src/core/model-router");

function fakeResponse({status,headers={}}){
  const normalized=Object.fromEntries(
    Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)])
  );
  return {
    status,
    ok:status>=200&&status<300,
    headers:{get(name){return normalized[String(name).toLowerCase()]||null;}},
    clone(){return {async json(){return {};}};},
    async json(){return {};}
  };
}

test("xAI adapter satisfies universal provider contract",()=>{
  const provider=createXaiProvider({env:{XAI_API_KEY:"test-key"}});
  assertProviderAdapter(provider);
  assert.equal(provider.supports("text"),true);
  assert.equal(provider.supports("structured_json"),true);
  assert.equal(provider.supports("images"),false);
});

test("xAI canonical text requests map to Responses API",()=>{
  const provider=createXaiProvider({
    env:{
      XAI_API_KEY:"test-key",
      XAI_TEXT_MODEL:"grok-4.7",
      XAI_REASONING_EFFORT:"xhigh"
    }
  });

  const request=provider.buildTextRequest({
    model:"grok-4.7",
    purpose:"code",
    instructions:"system",
    input:"hello"
  });

  assert.equal(request.endpointName,"responses");
  assert.deepEqual(request.payload,{
    model:"grok-4.7",
    instructions:"system",
    input:"hello",
    reasoning:{effort:"xhigh"}
  });
});

test("xAI structured request uses Responses JSON schema format",()=>{
  const provider=createXaiProvider({env:{XAI_API_KEY:"test-key"}});
  const schema={
    type:"object",
    additionalProperties:false,
    properties:{answer:{type:"string"}},
    required:["answer"]
  };
  const request=provider.buildStructuredRequest({
    model:"grok-4.7",
    input:"hello",
    schemaName:"answer",
    schema
  });

  assert.deepEqual(request.payload.text.format,{
    type:"json_schema",
    name:"answer",
    strict:true,
    schema
  });
});

test("xAI adapter owns bearer authentication and secret never appears publicly",()=>{
  const provider=createXaiProvider({env:{XAI_API_KEY:"xai-secret"}});
  assert.deepEqual(provider.authHeaders({"Content-Type":"application/json"}),{
    Authorization:"Bearer xai-secret",
    "Content-Type":"application/json"
  });
  assert.equal(JSON.stringify(provider.publicSummary()).includes("xai-secret"),false);
});

test("xAI response extraction ignores reasoning and returns visible output text",()=>{
  const provider=createXaiProvider({env:{XAI_API_KEY:"test-key"}});
  assert.equal(provider.extractText({output_text:"hello"}),"hello");
  assert.equal(provider.extractText({
    output:[
      {type:"reasoning",content:[{type:"text",text:"hidden"}]},
      {type:"message",content:[
        {type:"output_text",text:"one"},
        {type:"output_text",text:"two"}
      ]}
    ]
  }),"one\ntwo");
});

test("xAI retry policy retries 429/5xx but not client validation/auth errors",async()=>{
  const provider=createXaiProvider({env:{XAI_API_KEY:"test-key"}});

  const rate=await provider.retryDecision({
    response:fakeResponse({status:429,headers:{"retry-after":"2"}}),
    attempt:0
  });
  assert.equal(rate.retry,true);
  assert.equal(rate.delayMs,2000);

  const server=await provider.retryDecision({
    response:fakeResponse({status:503}),
    attempt:0
  });
  assert.equal(server.retry,true);

  for(const status of [400,401,403,404,415,422]){
    const decision=await provider.retryDecision({
      response:fakeResponse({status}),
      attempt:0
    });
    assert.equal(decision.retry,false,String(status));
  }
});

test("xAI configured Grok 4.7 metadata uses currently verified context and pricing",()=>{
  const provider=createXaiProvider({
    env:{XAI_API_KEY:"test-key",XAI_TEXT_MODEL:"grok-4.7"}
  });
  const model=provider.listModels()[0];
  assert.equal(model.contextWindow,500000);
  assert.equal(model.inputCostPerMillion,2);
  assert.equal(model.outputCostPerMillion,6);
});

test("xAI Models API discovery is mocked and retains unknown costs as null",async()=>{
  const calls=[];
  const provider=createXaiProvider({
    env:{XAI_API_KEY:"secret-key",XAI_TEXT_MODEL:"grok-4.7"}
  });

  const models=await provider.discoverModels({
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return {
        ok:true,
        status:200,
        async json(){
          return {
            data:[
              {
                id:"grok-4.7",
                context_length:500000,
                created:1770000000,
                owned_by:"xai"
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(models.length,1);
  assert.equal(models[0].contextWindow,500000);
  assert.equal(models[0].inputCostPerMillion,null);
  assert.equal(calls[0].url,"https://api.x.ai/v1/models");
  assert.equal(calls[0].init.headers.Authorization,"Bearer secret-key");
});

test("router orders OpenAI Anthropic Gemini then xAI by default",()=>{
  const providers=createProviderRegistry([
    createOpenAIProvider({env:{OPENAI_API_KEY:"a",OPENAI_TEXT_MODEL:"gpt"}}),
    createAnthropicProvider({env:{ANTHROPIC_API_KEY:"b",ANTHROPIC_TEXT_MODEL:"claude"}}),
    createGeminiProvider({env:{GEMINI_API_KEY:"c",GEMINI_TEXT_MODEL:"gemini-3.8-flash"}}),
    createXaiProvider({env:{XAI_API_KEY:"d",XAI_TEXT_MODEL:"grok-4.7"}})
  ]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});
  const plan=router.plan({capability:"text"});

  assert.equal(plan.primary.provider,"openai");
  assert.equal(plan.fallback.provider,"anthropic");
  assert.equal(plan.secondFallback.provider,"gemini");
  assert.equal(plan.candidates[3].provider,"xai");
});

test("router selects xAI when it is the only configured text provider",()=>{
  const providers=createProviderRegistry([
    createOpenAIProvider({env:{}}),
    createAnthropicProvider({env:{}}),
    createGeminiProvider({env:{}}),
    createXaiProvider({env:{XAI_API_KEY:"d"}})
  ]);
  const models=createModelRegistry({providerRegistry:providers});
  const router=createModelRouter({modelRegistry:models,providerRegistry:providers});

  assert.equal(router.plan({capability:"text"}).primary.provider,"xai");
  assert.equal(router.plan({capability:"code"}).primary.provider,"xai");
  assert.equal(router.plan({capability:"structured_json"}).primary.provider,"xai");
});
