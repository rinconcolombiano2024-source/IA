"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createResponsesCompatibleProvider
}=require("../src/providers/openai-compatible/responses-provider");

function createTestProvider(overrides={}){
  return createResponsesCompatibleProvider({
    id:"test-provider",
    name:"Test Provider",
    apiKey:"secret",
    baseUrl:"https://example.test/v1",
    textModel:"test/model",
    modelPriority:60,
    capabilities:["text","structured_json"],
    retryDecision:async()=>({retry:false,delayMs:0,reason:"test"}),
    networkRetryDelay:()=>1000,
    ...overrides
  });
}

test("Responses-compatible factory satisfies canonical text and structured operations",()=>{
  const provider=createTestProvider();
  const text=provider.buildTextRequest({
    model:"test/model",
    instructions:"system",
    input:"hello"
  });
  assert.equal(text.endpointName,"responses");
  assert.deepEqual(text.payload,{
    model:"test/model",
    instructions:"system",
    input:"hello"
  });

  const schema={type:"object",properties:{x:{type:"string"}},required:["x"]};
  const structured=provider.buildStructuredRequest({
    model:"test/model",
    input:"hello",
    schemaName:"schema_x",
    schema
  });
  assert.deepEqual(structured.payload.text.format,{
    type:"json_schema",
    name:"schema_x",
    strict:true,
    schema
  });
});

test("Responses-compatible factory keeps secrets out of public summaries",()=>{
  const provider=createTestProvider();
  assert.equal(JSON.stringify(provider.publicSummary()).includes("secret"),false);
  assert.equal(provider.authHeaders().Authorization,"Bearer secret");
});

test("Responses-compatible factory never invents discovered model costs",async()=>{
  const provider=createTestProvider({
    exactMetadata:{
      "test/model":{
        contextWindow:1000,
        inputCostPerMillion:1,
        outputCostPerMillion:2
      }
    }
  });

  const models=await provider.discoverModels({
    fetchImpl:async()=>({
      ok:true,
      status:200,
      async json(){
        return {
          data:[
            {id:"other/model",context_window:2048,owned_by:"other"}
          ]
        };
      }
    })
  });

  assert.equal(models[0].contextWindow,2048);
  assert.equal(models[0].inputCostPerMillion,null);
  assert.equal(models[0].outputCostPerMillion,null);
});
