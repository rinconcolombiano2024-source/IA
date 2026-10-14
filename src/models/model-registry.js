"use strict";

const { normalizeProviderId, normalizeCapabilities } = require("../providers/provider-contract");

function normalizeModelId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 160) {
    throw new Error("Invalid model id.");
  }
  return id;
}

function normalizeNullableNumber(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (options.min !== undefined && number < options.min) return null;
  if (options.max !== undefined && number > options.max) return null;
  return number;
}

function normalizeModalities(values) {
  const allowed = new Set(["text","image","audio","video","multimodal"]);
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const item = String(value || "").trim().toLowerCase();
    if (!allowed.has(item)) continue;
    if (!output.includes(item)) output.push(item);
  }
  return Object.freeze(output);
}

function normalizeModelDescriptor(input = {}) {
  const provider = normalizeProviderId(input.provider);
  const id = normalizeModelId(input.id);
  const capabilities = normalizeCapabilities(input.capabilities || []);
  const available = Boolean(input.available);
  const priority = Math.max(0, Math.min(1000, Number.parseInt(String(input.priority ?? 100), 10) || 100));

  return Object.freeze({
    key: `${provider}:${id}`,
    id,
    provider,
    capabilities,
    modalities: normalizeModalities(input.modalities),
    status: String(input.status || (available ? "available" : "unavailable")).trim().toLowerCase(),
    priority,
    contextWindow: normalizeNullableNumber(input.contextWindow, { min: 1 }),
    inputCostPerMillion: normalizeNullableNumber(input.inputCostPerMillion, { min: 0 }),
    outputCostPerMillion: normalizeNullableNumber(input.outputCostPerMillion, { min: 0 }),
    qualityScore: normalizeNullableNumber(input.qualityScore, { min: 0, max: 1 }),
    latencyMs: normalizeNullableNumber(input.latencyMs, { min: 0 }),
    errorRate: normalizeNullableNumber(input.errorRate, { min: 0, max: 1 }),
    available,
    toolCompatible: Boolean(input.toolCompatible),
    source: String(input.source || "configured").trim().toLowerCase(),
    metadata: input.metadata && typeof input.metadata === "object"
      ? Object.freeze({ ...input.metadata })
      : Object.freeze({})
  });
}

function createModelRegistry(options = {}) {
  const providerRegistry = options.providerRegistry;
  const models = new Map();

  function upsert(descriptor) {
    const model = normalizeModelDescriptor(descriptor);
    models.set(model.key, model);
    return model;
  }

  function registerMany(descriptors) {
    const registered = [];
    for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
      registered.push(upsert(descriptor));
    }
    return registered;
  }

  function replaceProviderModels(providerId, descriptors) {
    const normalizedProvider = normalizeProviderId(providerId);
    const staged = new Map();

    for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
      const model = normalizeModelDescriptor(descriptor);
      if (model.provider !== normalizedProvider) {
        throw new Error(
          `Model provider mismatch: expected ${normalizedProvider}, got ${model.provider}.`
        );
      }
      staged.set(model.key, model);
    }

    for (const key of Array.from(models.keys())) {
      if (key.startsWith(`${normalizedProvider}:`)) {
        models.delete(key);
      }
    }

    for (const [key, model] of staged) {
      models.set(key, model);
    }

    return Array.from(staged.values());
  }

  function get(providerId, modelId) {
    const key = `${normalizeProviderId(providerId)}:${normalizeModelId(modelId)}`;
    return models.get(key) || null;
  }

  function list() {
    return Array.from(models.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.key.localeCompare(b.key);
    });
  }

  function listPublic() {
    return list().map((model) => ({ ...model }));
  }

  function findByCapability(capability, options = {}) {
    const providerId = options.provider ? normalizeProviderId(options.provider) : "";
    const requireAvailable = options.available !== false;

    return list().filter((model) => {
      if (providerId && model.provider !== providerId) return false;
      if (requireAvailable && !model.available) return false;
      return model.capabilities.includes(String(capability || "").trim().toLowerCase());
    });
  }

  function syncProvider(provider) {
    if (!provider || typeof provider.listModels !== "function") {
      throw new Error("Provider does not expose listModels().");
    }

    const providerId = normalizeProviderId(provider.id);
    return replaceProviderModels(providerId, provider.listModels());
  }

  function syncAllProviders() {
    if (!providerRegistry || typeof providerRegistry.list !== "function") {
      return [];
    }

    const synced = [];
    for (const provider of providerRegistry.list()) {
      synced.push(...syncProvider(provider));
    }
    return synced;
  }

  async function refreshProvider(provider, options = {}) {
    if (
      options.discover === true &&
      typeof provider?.discoverModels === "function"
    ) {
      const discovered = await provider.discoverModels(
        options.discoveryOptions || {}
      );
      const providerId = normalizeProviderId(provider.id);
      return replaceProviderModels(providerId, discovered);
    }

    return syncProvider(provider);
  }

  function summary() {
    const all = list();
    return {
      total: all.length,
      available: all.filter((model) => model.available).length,
      providers: [...new Set(all.map((model) => model.provider))].length
    };
  }

  syncAllProviders();

  return Object.freeze({
    upsert,
    registerMany,
    replaceProviderModels,
    get,
    list,
    listPublic,
    findByCapability,
    syncProvider,
    syncAllProviders,
    refreshProvider,
    summary
  });
}

module.exports = {
  createModelRegistry,
  normalizeModelDescriptor,
  normalizeModelId,
  normalizeNullableNumber,
  normalizeModalities
};
