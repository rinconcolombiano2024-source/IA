"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createModelRouter } = require("../src/core/model-router");
const { createProviderHealth } = require("../src/core/provider-health");

function model(provider, id, priority) {
  return {
    key: provider + ":" + id,
    provider,
    id,
    priority,
    qualityScore:null,
    errorRate:null,
    latencyMs:null,
    inputCostPerMillion:null,
    outputCostPerMillion:null,
    capabilities:["text"],
    available:true
  };
}

function registry(models) {
  return {
    findByCapability() {
      return models;
    }
  };
}

function providers(ids) {
  const map = new Map(ids.map((id) => [id,{id,isConfigured:()=>true}]));
  return {
    require(id) {
      const provider = map.get(id);
      if (!provider) throw new Error("missing");
      return provider;
    }
  };
}

function healthFailure(code = "PROVIDER_NETWORK_ERROR") {
  const error = new Error(code);
  error.code = code;
  return error;
}

test("automatic routing excludes an open provider circuit", () => {
  const health = createProviderHealth({failureThreshold:1,openMs:60_000});
  health.recordFailure("alpha",healthFailure());

  const router = createModelRouter({
    modelRegistry:registry([
      model("alpha","a",10),
      model("beta","b",20)
    ]),
    providerRegistry:providers(["alpha","beta"]),
    providerHealth:health
  });

  const plan = router.plan({capability:"text"});
  assert.equal(plan.primary.provider,"beta");
});

test("manual provider selection may intentionally bypass circuit filtering", () => {
  const health = createProviderHealth({failureThreshold:1,openMs:60_000});
  health.recordFailure("alpha",healthFailure());

  const router = createModelRouter({
    modelRegistry:registry([
      model("alpha","a",10),
      model("beta","b",20)
    ]),
    providerRegistry:providers(["alpha","beta"]),
    providerHealth:health
  });

  const plan = router.plan({
    capability:"text",
    preferredProvider:"alpha"
  });

  assert.equal(plan.primary.provider,"alpha");
});

test("degraded health can demote a provider before circuit opens", () => {
  const health = createProviderHealth({failureThreshold:3,openMs:60_000});
  health.recordFailure("alpha",healthFailure(),500);

  const router = createModelRouter({
    modelRegistry:registry([
      model("alpha","a",10),
      model("beta","b",20)
    ]),
    providerRegistry:providers(["alpha","beta"]),
    providerHealth:health
  });

  const plan = router.plan({capability:"text"});
  assert.equal(plan.primary.provider,"beta");

  const publicPlan = router.publicPlan(plan);
  assert.ok(publicPlan.primary.healthScore <= 100);
  assert.equal(typeof publicPlan.primary.circuit,"string");
});
