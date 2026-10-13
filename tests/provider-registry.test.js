"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CAPABILITIES, normalizeCapabilities, assertProviderAdapter } = require("../src/providers/provider-contract");
const { createProviderRegistry } = require("../src/providers/registry");
const { createOpenAIProvider } = require("../src/providers/openai/provider");

test("provider capability contract rejects unknown capabilities", () => {
  assert.ok(CAPABILITIES.includes("text"));
  assert.deepEqual(normalizeCapabilities(["text","text","video"]), ["text","video"]);
  assert.throws(() => normalizeCapabilities(["telepathy"]));
});
test("OpenAI adapter centralizes credentials and model resolution", () => {
  const provider = createOpenAIProvider({ env: {
    OPENAI_API_KEY:"sk-test-secret-value", OPENAI_TEXT_MODEL:"model-text",
    OPENAI_IMAGE_MODEL:"model-image", OPENAI_VIDEO_MODEL:"model-video"
  }});
  assertProviderAdapter(provider);
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.credential(), "sk-test-secret-value");
  assert.equal(provider.modelFor("text"), "model-text");
  assert.equal(provider.modelFor("reasoning"), "model-text");
  assert.equal(provider.modelFor("code"), "model-text");
  assert.equal(provider.modelFor("images"), "model-image");
  assert.equal(provider.modelFor("video"), "model-video");
  assert.equal(provider.supports("structured_json"), true);
  assert.equal(provider.supports("embeddings"), false);
});
test("OpenAI public summary never leaks the API key", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-private-value" }});
  assert.equal(JSON.stringify(provider.publicSummary()).includes("sk-private-value"), false);
});
test("OpenAI placeholder API key remains unconfigured", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"pon-tu-clave-aqui" }});
  assert.equal(provider.isConfigured(), false);
  assert.equal(provider.credential(), "");
});
test("provider registry prevents duplicates and supports capability discovery", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-test" }});
  const registry = createProviderRegistry([provider]);
  assert.equal(registry.require("openai"), provider);
  assert.equal(registry.configured().length, 1);
  assert.equal(registry.findByCapability("text").length, 1);
  assert.equal(registry.findByCapability("embeddings").length, 0);
  assert.throws(() => registry.register(provider));
});
test("registry public snapshot contains no provider credentials", () => {
  const provider = createOpenAIProvider({ env:{ OPENAI_API_KEY:"sk-private-value" }});
  const registry = createProviderRegistry([provider]);
  assert.equal(JSON.stringify(registry.listPublic()).includes("sk-private-value"), false);
});
