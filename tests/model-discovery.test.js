"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProviderRegistry } = require("../src/providers/registry");
const { createModelRegistry } = require("../src/models/model-registry");
const { createModelDiscovery } = require("../src/models/model-discovery");

function provider(id, options = {}) {
  const configured = options.configured !== false;
  const baseModel = options.baseModel || id + "-base";
  const value = {
    id,
    capabilities:["text"],
    isConfigured:()=>configured,
    supports:(capability)=>capability === "text",
    modelFor:()=>baseModel,
    listModels:()=>[{
      id:baseModel,
      provider:id,
      capabilities:["text"],
      modalities:["text"],
      available:configured,
      priority:10,
      source:"configured"
    }],
    credential:()=>configured ? "secret" : "",
    endpoint:()=> "https://example.test",
    authHeaders:()=>({}),
    buildTextRequest:()=>({}),
    buildStructuredRequest:()=>({}),
    extractText:()=>"",
    requestPolicy:()=>({timeoutMs:1000,maxRetries:0}),
    retryDecision:async()=>({retry:false,delayMs:0}),
    networkRetryDelay:()=>0,
    errorMessage:()=> "error",
    publicSummary:()=>({id,configured})
  };

  if (options.discover) {
    value.discoverModels = options.discover;
  }

  return value;
}

test("discovery refresh is single-flight and respects TTL", async () => {
  let calls = 0;
  let clock = 1000;
  const p = provider("alpha",{
    discover:async()=> {
      calls += 1;
      await new Promise((resolve)=>setTimeout(resolve,10));
      return [{
        id:"alpha-dynamic",
        provider:"alpha",
        capabilities:["text"],
        modalities:["text"],
        available:true,
        priority:5,
        source:"discovered"
      }];
    }
  });
  const providers = createProviderRegistry([p]);
  const models = createModelRegistry({providerRegistry:providers});
  const discovery = createModelDiscovery({
    providerRegistry:providers,
    modelRegistry:models,
    intervalMs:60_000,
    now:()=>clock,
    fetchImpl:async()=>{ throw new Error("unused"); }
  });

  await Promise.all([
    discovery.refreshIfDue(),
    discovery.refreshIfDue()
  ]);

  assert.equal(calls,1);
  assert.equal(models.get("alpha","alpha-dynamic").source,"discovered");

  await discovery.refreshIfDue();
  assert.equal(calls,1);

  clock += 60_001;
  await discovery.refreshIfDue();
  assert.equal(calls,2);
});

test("failed discovery preserves last valid provider inventory", async () => {
  const p = provider("alpha",{
    discover:async()=> {
      throw new Error("upstream failed");
    }
  });
  const providers = createProviderRegistry([p]);
  const models = createModelRegistry({providerRegistry:providers});
  const discovery = createModelDiscovery({
    providerRegistry:providers,
    modelRegistry:models,
    fetchImpl:async()=>{ throw new Error("unused"); }
  });

  assert.ok(models.get("alpha","alpha-base"));
  await discovery.refreshIfDue({force:true});

  assert.ok(models.get("alpha","alpha-base"));
  assert.equal(discovery.summary().providers[0].status,"error");
  assert.equal(
    discovery.summary().providers[0].errorCode,
    "MODEL_DISCOVERY_FAILED"
  );
});

test("providers without discovery are left untouched", async () => {
  const p = provider("alpha");
  const providers = createProviderRegistry([p]);
  const models = createModelRegistry({providerRegistry:providers});
  const discovery = createModelDiscovery({
    providerRegistry:providers,
    modelRegistry:models,
    fetchImpl:async()=>{ throw new Error("unused"); }
  });

  await discovery.refreshIfDue({force:true});
  assert.ok(models.get("alpha","alpha-base"));
  assert.equal(discovery.summary().providers[0].status,"unsupported");
});
