"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProviderRegistry } = require("../src/providers/registry");
const { createModelRegistry } = require("../src/models/model-registry");

function baseProvider() {
  return {
    id:"alpha",
    capabilities:["text"],
    isConfigured:()=>true,
    supports:(cap)=>cap === "text",
    modelFor:()=> "stable-model",
    listModels:()=>[{
      id:"stable-model",
      provider:"alpha",
      capabilities:["text"],
      modalities:["text"],
      available:true,
      priority:10,
      source:"configured"
    }],
    credential:()=> "secret",
    endpoint:()=> "https://example.test",
    authHeaders:()=>({}),
    buildTextRequest:()=>({}),
    buildStructuredRequest:()=>({}),
    extractText:()=>"",
    requestPolicy:()=>({timeoutMs:1000,maxRetries:0}),
    retryDecision:async()=>({retry:false,delayMs:0}),
    networkRetryDelay:()=>0,
    errorMessage:()=> "error",
    publicSummary:()=>({id:"alpha"})
  };
}

test("atomic provider replacement preserves inventory when new descriptors are invalid", async () => {
  const p = baseProvider();
  const providers = createProviderRegistry([p]);
  const models = createModelRegistry({providerRegistry:providers});

  const discoverable = {
    ...p,
    async discoverModels() {
      return [
        {
          id:"valid-first",
          provider:"alpha",
          capabilities:["text"],
          modalities:["text"],
          available:true
        },
        {
          id:"",
          provider:"alpha",
          capabilities:["text"],
          modalities:["text"],
          available:true
        }
      ];
    }
  };

  await assert.rejects(
    models.refreshProvider(discoverable,{discover:true}),
    /Invalid model id/
  );

  assert.ok(models.get("alpha","stable-model"));
  assert.equal(models.get("alpha","valid-first"),null);
});

test("atomic provider replacement rejects cross-provider descriptors without mutation", () => {
  const p = baseProvider();
  const providers = createProviderRegistry([p]);
  const models = createModelRegistry({providerRegistry:providers});

  assert.throws(
    () => models.replaceProviderModels("alpha",[{
      id:"wrong-owner",
      provider:"beta",
      capabilities:["text"],
      modalities:["text"],
      available:true
    }]),
    /Model provider mismatch/
  );

  assert.ok(models.get("alpha","stable-model"));
});
