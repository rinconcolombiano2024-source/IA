"use strict";
const CAPABILITIES = Object.freeze([
  "text","reasoning","code","vision","images","audio","voice","embeddings",
  "search","tools","structured_json","streaming","video","multimodal"
]);
const CAPABILITY_SET = new Set(CAPABILITIES);
function normalizeProviderId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(id)) throw new Error("Invalid provider id.");
  return id;
}
function normalizeCapabilities(values) {
  const input = Array.isArray(values) ? values : [];
  const capabilities = [];
  for (const value of input) {
    const capability = String(value || "").trim().toLowerCase();
    if (!CAPABILITY_SET.has(capability)) {
      throw new Error(`Unknown provider capability: ${capability || "(empty)"}`);
    }
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  return Object.freeze(capabilities);
}
function assertProviderAdapter(provider) {
  if (!provider || typeof provider !== "object") throw new Error("Provider adapter must be an object.");
  const id = normalizeProviderId(provider.id);
  const requiredMethods = [
    "isConfigured","supports","modelFor","credential","endpoint","authHeaders",
    "retryDecision","networkRetryDelay","errorMessage","publicSummary"
  ];
  for (const method of requiredMethods) {
    if (typeof provider[method] !== "function") {
      throw new Error(`Provider ${id} is missing method ${method}().`);
    }
  }
  normalizeCapabilities(provider.capabilities);
  return provider;
}
module.exports = { CAPABILITIES, normalizeProviderId, normalizeCapabilities, assertProviderAdapter };
