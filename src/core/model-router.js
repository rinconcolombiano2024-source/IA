"use strict";

const { normalizeProviderId } = require("../providers/provider-contract");
const { normalizeModelId } = require("../models/model-registry");

const INTENT_CAPABILITIES = Object.freeze({
  text: "text",
  document: "text",
  restaurant: "text",
  book: "text",
  code: "code",
  website: "code",
  image: "images",
  video: "video",
  repair: "reasoning"
});

function capabilityForIntent(intent) {
  return INTENT_CAPABILITIES[String(intent || "").trim().toLowerCase()] || "text";
}

function compareNullableAscending(left, right, selector) {
  const a = selector(left);
  const b = selector(right);
  const aKnown = Number.isFinite(a);
  const bKnown = Number.isFinite(b);

  if (aKnown && bKnown && a !== b) return a - b;
  if (aKnown && !bKnown) return -1;
  if (!aKnown && bKnown) return 1;
  return 0;
}

function compareNullableDescending(left, right, selector) {
  return compareNullableAscending(right, left, selector);
}

function rankModels(models) {
  return [...models].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;

    const quality = compareNullableDescending(a, b, (model) => model.qualityScore);
    if (quality !== 0) return quality;

    const errors = compareNullableAscending(a, b, (model) => model.errorRate);
    if (errors !== 0) return errors;

    const latency = compareNullableAscending(a, b, (model) => model.latencyMs);
    if (latency !== 0) return latency;

    const aCost =
      Number.isFinite(a.inputCostPerMillion) && Number.isFinite(a.outputCostPerMillion)
        ? a.inputCostPerMillion + a.outputCostPerMillion
        : null;
    const bCost =
      Number.isFinite(b.inputCostPerMillion) && Number.isFinite(b.outputCostPerMillion)
        ? b.inputCostPerMillion + b.outputCostPerMillion
        : null;
    const cost = compareNullableAscending(
      { value: aCost },
      { value: bCost },
      (entry) => entry.value
    );
    if (cost !== 0) return cost;

    return a.key.localeCompare(b.key);
  });
}

function createRoutingError(message, code, details = {}) {
  const error = new Error(message);
  error.name = "RoutingRequestError";
  error.code = code;
  error.routing = details;
  error.statusCode = 400;
  error.publicMessage = message;
  error.isClientRequestError = true;
  return error;
}

function createModelRouter(options = {}) {
  const modelRegistry = options.modelRegistry;
  const providerRegistry = options.providerRegistry;

  if (!modelRegistry || typeof modelRegistry.findByCapability !== "function") {
    throw new Error("Model router requires a model registry.");
  }

  if (!providerRegistry || typeof providerRegistry.require !== "function") {
    throw new Error("Model router requires a provider registry.");
  }

  function plan(input = {}) {
    const capability = String(input.capability || "text").trim().toLowerCase();
    let preferredProvider = "";
    let preferredModel = "";

    if (input.preferredProvider) {
      try {
        preferredProvider = normalizeProviderId(input.preferredProvider);
      } catch {
        throw createRoutingError(
          "El proveedor solicitado no es valido.",
          "INVALID_PROVIDER_SELECTION"
        );
      }
    }

    if (input.preferredModel) {
      try {
        preferredModel = normalizeModelId(input.preferredModel);
      } catch {
        throw createRoutingError(
          "El modelo solicitado no es valido.",
          "INVALID_MODEL_SELECTION"
        );
      }
    }

    let candidates = modelRegistry.findByCapability(capability);

    if (preferredProvider) {
      candidates = candidates.filter((model) => model.provider === preferredProvider);
    }

    if (preferredModel) {
      candidates = candidates.filter((model) => model.id === preferredModel);
    }

    candidates = rankModels(candidates);

    if (!candidates.length) {
      throw createRoutingError(
        "No hay un modelo disponible para la capacidad solicitada.",
        "NO_MODEL_AVAILABLE",
        {
          capability,
          preferredProvider: preferredProvider || null,
          preferredModel: preferredModel || null
        }
      );
    }

    const [primary = null, fallback = null, secondFallback = null] = candidates;

    return Object.freeze({
      capability,
      primary,
      fallback,
      secondFallback,
      candidateCount: candidates.length,
      candidates: Object.freeze(candidates.slice(0, 8)),
      strategy: "deterministic_capability_rank"
    });
  }

  function providerFor(selection) {
    if (!selection?.provider) {
      throw createRoutingError(
        "La seleccion de modelo no contiene proveedor.",
        "INVALID_MODEL_SELECTION"
      );
    }

    const provider = providerRegistry.require(selection.provider);
    if (!provider.isConfigured()) {
      throw createRoutingError(
        "El proveedor seleccionado no esta configurado.",
        "PROVIDER_NOT_CONFIGURED",
        { provider: selection.provider }
      );
    }

    return provider;
  }

  function publicPlan(planValue) {
    if (!planValue) return null;
    const compact = (model) =>
      model
        ? {
            provider: model.provider,
            model: model.id,
            capabilities: [...model.capabilities],
            priority: model.priority
          }
        : null;

    return {
      capability: planValue.capability,
      strategy: planValue.strategy,
      candidateCount: planValue.candidateCount,
      primary: compact(planValue.primary),
      fallback: compact(planValue.fallback),
      secondFallback: compact(planValue.secondFallback)
    };
  }

  return Object.freeze({
    plan,
    providerFor,
    publicPlan,
    rankModels
  });
}

module.exports = {
  createModelRouter,
  capabilityForIntent,
  rankModels,
  createRoutingError
};
