"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProviderRegistry } = require("../src/providers/registry");
const { createOpenAIProvider } = require("../src/providers/openai/provider");
const {
  createModelRegistry,
  normalizeModelDescriptor
} = require("../src/models/model-registry");

test("model descriptors keep unknown commercial/runtime metadata as null", () => {
  const model = normalizeModelDescriptor({
    id:"model-a",
    provider:"openai",
    capabilities:["text"],
    modalities:["text"],
    available:true
  });

  assert.equal(model.contextWindow, null);
  assert.equal(model.inputCostPerMillion, null);
  assert.equal(model.outputCostPerMillion, null);
  assert.equal(model.qualityScore, null);
  assert.equal(model.latencyMs, null);
  assert.equal(model.errorRate, null);
});

test("OpenAI provider publishes configured text/image/video model descriptors", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_TEXT_MODEL:"text-model",
      OPENAI_IMAGE_MODEL:"image-model",
      OPENAI_VIDEO_MODEL:"video-model"
    }
  });

  const models = provider.listModels();
  assert.equal(models.length,3);

  const text = models.find((model) => model.id === "text-model");
  assert.deepEqual(text.capabilities,["text","reasoning","code","structured_json"]);
  assert.equal(text.available,true);
  assert.equal(text.contextWindow,null);
});

test("duplicate configured model ids are merged instead of duplicated", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_TEXT_MODEL:"same-model",
      OPENAI_IMAGE_MODEL:"same-model",
      OPENAI_VIDEO_MODEL:"video-model"
    }
  });

  const models = provider.listModels();
  assert.equal(models.length,2);
  const shared = models.find((model) => model.id === "same-model");
  assert.ok(shared.capabilities.includes("text"));
  assert.ok(shared.capabilities.includes("images"));
});

test("model registry indexes provider models and capability lookups", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_TEXT_MODEL:"text-model",
      OPENAI_IMAGE_MODEL:"image-model",
      OPENAI_VIDEO_MODEL:"video-model"
    }
  });
  const providers = createProviderRegistry([provider]);
  const registry = createModelRegistry({providerRegistry:providers});

  assert.equal(registry.summary().total,3);
  assert.equal(registry.summary().available,3);
  assert.equal(registry.findByCapability("code").length,1);
  assert.equal(registry.findByCapability("images").length,1);
  assert.equal(registry.get("openai","text-model").id,"text-model");
});

test("unconfigured providers expose models but mark them unavailable", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_TEXT_MODEL:"text-model",
      OPENAI_IMAGE_MODEL:"image-model",
      OPENAI_VIDEO_MODEL:"video-model"
    }
  });
  const providers = createProviderRegistry([provider]);
  const registry = createModelRegistry({providerRegistry:providers});

  assert.equal(registry.summary().total,3);
  assert.equal(registry.summary().available,0);
  assert.equal(registry.findByCapability("text").length,0);
  assert.equal(registry.findByCapability("text",{available:false}).length,1);
});

test("model registry can refresh from optional provider discovery without core changes", async () => {
  const provider = createOpenAIProvider({env:{OPENAI_API_KEY:"sk-test"}});
  const discoverable = {
    ...provider,
    async discoverModels() {
      return [{
        id:"dynamic-model",
        provider:"openai",
        capabilities:["text"],
        modalities:["text"],
        available:true,
        priority:5,
        source:"discovered"
      }];
    }
  };

  const providers = createProviderRegistry([]);
  const registry = createModelRegistry({providerRegistry:providers});
  await registry.refreshProvider(discoverable,{discover:true});

  assert.equal(registry.summary().total,1);
  assert.equal(registry.get("openai","dynamic-model").source,"discovered");
});
