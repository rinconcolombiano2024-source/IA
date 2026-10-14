"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProviderRegistry } = require("../src/providers/registry");
const { createOpenAIProvider } = require("../src/providers/openai/provider");
const { createModelRegistry } = require("../src/models/model-registry");
const {
  createModelRouter,
  capabilityForIntent,
  rankModels
} = require("../src/core/model-router");

function fakeModel(overrides = {}) {
  return {
    key:"alpha:model",
    id:"model",
    provider:"alpha",
    capabilities:["text"],
    modalities:["text"],
    status:"available",
    priority:100,
    contextWindow:null,
    inputCostPerMillion:null,
    outputCostPerMillion:null,
    qualityScore:null,
    latencyMs:null,
    errorRate:null,
    available:true,
    toolCompatible:false,
    source:"configured",
    metadata:{},
    ...overrides
  };
}

test("intent capability mapping is stable", () => {
  assert.equal(capabilityForIntent("image"),"images");
  assert.equal(capabilityForIntent("video"),"video");
  assert.equal(capabilityForIntent("code"),"code");
  assert.equal(capabilityForIntent("website"),"code");
  assert.equal(capabilityForIntent("repair"),"reasoning");
  assert.equal(capabilityForIntent("unknown"),"text");
});

test("ranking prefers lower priority before optional runtime metadata", () => {
  const ranked = rankModels([
    fakeModel({key:"p:b",id:"b",priority:20,qualityScore:1}),
    fakeModel({key:"p:a",id:"a",priority:10,qualityScore:0})
  ]);
  assert.equal(ranked[0].id,"a");
});

test("ranking uses known quality, error rate and latency only after equal priority", () => {
  const ranked = rankModels([
    fakeModel({key:"p:a",id:"a",priority:10,qualityScore:0.7,errorRate:0.05,latencyMs:800}),
    fakeModel({key:"p:b",id:"b",priority:10,qualityScore:0.9,errorRate:0.30,latencyMs:200})
  ]);
  assert.equal(ranked[0].id,"b");
});

test("router emits primary, fallback and second fallback deterministically", () => {
  const models = [
    fakeModel({key:"a:m1",provider:"a",id:"m1",priority:10}),
    fakeModel({key:"b:m2",provider:"b",id:"m2",priority:20}),
    fakeModel({key:"c:m3",provider:"c",id:"m3",priority:30})
  ];

  const modelRegistry = {
    findByCapability(capability) {
      assert.equal(capability,"text");
      return models;
    }
  };
  const providerRegistry = {
    require(id) {
      return {id,isConfigured:()=>true};
    }
  };

  const router = createModelRouter({modelRegistry,providerRegistry});
  const plan = router.plan({capability:"text"});

  assert.equal(plan.primary.id,"m1");
  assert.equal(plan.fallback.id,"m2");
  assert.equal(plan.secondFallback.id,"m3");
  assert.equal(plan.candidateCount,3);
});

test("manual provider/model filters fail closed when unavailable", () => {
  const modelRegistry = {
    findByCapability() {
      return [fakeModel({provider:"openai",key:"openai:m1",id:"m1"})];
    }
  };
  const providerRegistry = {require(){return {isConfigured:()=>true};}};
  const router = createModelRouter({modelRegistry,providerRegistry});

  assert.throws(
    () => router.plan({capability:"text",preferredProvider:"other"}),
    (error) => error.code === "NO_MODEL_AVAILABLE"
  );
  assert.throws(
    () => router.plan({capability:"text",preferredModel:"missing"}),
    (error) => error.code === "NO_MODEL_AVAILABLE"
  );
});

test("production registry currently selects the configured OpenAI model without regression", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_TEXT_MODEL:"text-model",
      OPENAI_IMAGE_MODEL:"image-model",
      OPENAI_VIDEO_MODEL:"video-model"
    }
  });
  const providers = createProviderRegistry([provider]);
  const models = createModelRegistry({providerRegistry:providers});
  const router = createModelRouter({modelRegistry:models,providerRegistry:providers});

  assert.equal(router.plan({capability:"text"}).primary.id,"text-model");
  assert.equal(router.plan({capability:"code"}).primary.id,"text-model");
  assert.equal(router.plan({capability:"images"}).primary.id,"image-model");
  assert.equal(router.plan({capability:"video"}).primary.id,"video-model");
});

test("public routing plans never expose credentials or provider internals", () => {
  const provider = createOpenAIProvider({env:{OPENAI_API_KEY:"sk-private"}});
  const providers = createProviderRegistry([provider]);
  const models = createModelRegistry({providerRegistry:providers});
  const router = createModelRouter({modelRegistry:models,providerRegistry:providers});

  const snapshot = JSON.stringify(router.publicPlan(router.plan({capability:"text"})));
  assert.equal(snapshot.includes("sk-private"),false);
});
