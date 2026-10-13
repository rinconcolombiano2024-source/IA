"use strict";
const { assertProviderAdapter, normalizeProviderId } = require("./provider-contract");
function createProviderRegistry(initialProviders = []) {
  const providers = new Map();
  function register(provider) {
    const adapter = assertProviderAdapter(provider);
    const id = normalizeProviderId(adapter.id);
    if (providers.has(id)) throw new Error(`Provider already registered: ${id}`);
    providers.set(id, adapter);
    return adapter;
  }
  function get(id) { return providers.get(normalizeProviderId(id)) || null; }
  function requireProvider(id) {
    const provider = get(id);
    if (!provider) throw new Error(`Provider not registered: ${id}`);
    return provider;
  }
  function list() { return Array.from(providers.values()); }
  function listPublic() { return list().map((provider) => provider.publicSummary()); }
  function configured() { return list().filter((provider) => provider.isConfigured()); }
  function findByCapability(capability, options = {}) {
    const requireConfigured = options.configured !== false;
    return list().filter((provider) => {
      if (requireConfigured && !provider.isConfigured()) return false;
      return provider.supports(capability);
    });
  }
  for (const provider of initialProviders) register(provider);
  return Object.freeze({ register, get, require: requireProvider, list, listPublic, configured, findByCapability });
}
module.exports = { createProviderRegistry };
