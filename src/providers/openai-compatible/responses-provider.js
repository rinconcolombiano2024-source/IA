"use strict";

const { normalizeCapabilities } = require("../provider-contract");

function normalizeIdentifier(value, label = "provider id") {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(text)) {
    throw new Error(`Invalid ${label}.`);
  }
  return text;
}

function normalizeModel(value, fallback = "") {
  const model = String(value || fallback || "").trim();
  if (!model || model.length > 180 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    throw new Error("Invalid model id.");
  }
  return model;
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Responses-compatible provider requires a base URL.");

  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("Responses-compatible provider base URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Responses-compatible provider base URL must not contain credentials.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createResponsesCompatibleProvider(options = {}) {
  const id = normalizeIdentifier(options.id);
  const name = String(options.name || id).trim() || id;
  const apiKey = String(options.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const textModel = normalizeModel(options.textModel, options.defaultModel);
  const modelPriority = normalizeInteger(options.modelPriority, 100, 0, 1000);
  const policy = Object.freeze({
    timeoutMs: normalizeInteger(options.timeoutMs, 120_000, 1_000, 3_600_000),
    maxRetries: normalizeInteger(options.maxRetries, 2, 0, 5)
  });
  const capabilities = normalizeCapabilities(
    options.capabilities || ["text"]
  );
  const exactMetadata = options.exactMetadata && typeof options.exactMetadata === "object"
    ? options.exactMetadata
    : {};
  const retryDecisionImpl = options.retryDecision;
  const networkRetryDelayImpl = options.networkRetryDelay;

  if (typeof retryDecisionImpl !== "function") {
    throw new Error(`Provider ${id} requires retryDecision.`);
  }
  if (typeof networkRetryDelayImpl !== "function") {
    throw new Error(`Provider ${id} requires networkRetryDelay.`);
  }

  function isConfigured() {
    return Boolean(apiKey);
  }

  function supports(capability) {
    return capabilities.includes(String(capability || "").trim().toLowerCase());
  }

  function modelFor(capability) {
    return supports(capability) ? textModel : "";
  }

  function credential(key = "apiKey") {
    return key === "apiKey" ? apiKey : "";
  }

  function endpoint(endpointName) {
    const key = String(endpointName || "").trim().toLowerCase();
    if (key === "responses") return `${baseUrl}/responses`;
    if (key === "models") return `${baseUrl}/models`;
    throw new Error(`Unsupported ${name} endpoint: ${endpointName}`);
  }

  function authHeaders(extra = {}) {
    if (!apiKey) {
      throw new Error(`${name} provider is not configured.`);
    }
    return {
      Authorization: `Bearer ${apiKey}`,
      ...extra
    };
  }

  function buildTextRequest(input = {}) {
    const payload = {
      model: normalizeModel(input.model, textModel),
      instructions: String(input.instructions || ""),
      input: String(input.input || "")
    };

    if (typeof options.enrichTextPayload === "function") {
      options.enrichTextPayload(payload, input);
    }

    return {
      endpointName: "responses",
      payload
    };
  }

  function buildStructuredRequest(input = {}) {
    const schemaName = String(input.schemaName || "structured_output").trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(schemaName)) {
      throw new Error("Invalid structured output schema name.");
    }
    if (!input.schema || typeof input.schema !== "object") {
      throw new Error("Structured output requires a JSON schema.");
    }

    const request = buildTextRequest(input);
    request.payload.text = {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: input.strict !== false,
        schema: input.schema
      }
    };
    return request;
  }

  function extractText(data) {
    if (typeof data?.output_text === "string") {
      return data.output_text.trim();
    }

    if (!Array.isArray(data?.output)) return "";
    return data.output
      .flatMap((item) =>
        Array.isArray(item?.content) ? item.content : []
      )
      .filter((content) =>
        content?.type === "output_text" &&
        typeof content?.text === "string"
      )
      .map((content) => content.text)
      .join("\n")
      .trim();
  }

  function descriptorFor(modelId, configured = false, metadata = {}) {
    const exact = exactMetadata[modelId] || {};
    return {
      id: modelId,
      provider: id,
      capabilities: configured ? [...capabilities] : ["text"],
      modalities: ["text"],
      status: isConfigured() ? "available" : "unconfigured",
      priority: configured ? modelPriority : 100,
      contextWindow: Number.isFinite(Number(exact.contextWindow))
        ? Number(exact.contextWindow)
        : Number.isFinite(Number(metadata.contextWindow))
          ? Number(metadata.contextWindow)
          : null,
      inputCostPerMillion: Number.isFinite(Number(exact.inputCostPerMillion))
        ? Number(exact.inputCostPerMillion)
        : null,
      outputCostPerMillion: Number.isFinite(Number(exact.outputCostPerMillion))
        ? Number(exact.outputCostPerMillion)
        : null,
      qualityScore: null,
      latencyMs: null,
      errorRate: null,
      available: isConfigured(),
      toolCompatible: Boolean(exact.toolCompatible),
      source: metadata.discovered ? "discovered" : "configured",
      metadata: {
        discovered: Boolean(metadata.discovered),
        ownedBy: String(metadata.ownedBy || ""),
        created: Number.isFinite(Number(metadata.created))
          ? Number(metadata.created)
          : null
      }
    };
  }

  function listModels() {
    return [descriptorFor(textModel, true)];
  }

  async function discoverModels(discoveryOptions = {}) {
    if (!isConfigured()) return listModels();

    const fetchImpl = discoveryOptions.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error(`${name} model discovery requires fetch.`);
    }

    const response = await fetchImpl(endpoint("models"), {
      method: "GET",
      headers: authHeaders({
        Accept: "application/json"
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(errorMessage(data));
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    const descriptors = rows
      .map((item) => {
        const modelId = String(item?.id || "").trim();
        if (!modelId) return null;
        return descriptorFor(modelId, modelId === textModel, {
          discovered: true,
          contextWindow: item?.context_window,
          ownedBy: item?.owned_by,
          created: item?.created
        });
      })
      .filter(Boolean);

    return descriptors.length ? descriptors : listModels();
  }

  function requestPolicy() {
    return policy;
  }

  async function retryDecision(args = {}) {
    return retryDecisionImpl(args);
  }

  function networkRetryDelay(attempt) {
    return networkRetryDelayImpl(attempt);
  }

  function errorMessage(data) {
    if (data?.error?.message) return String(data.error.message);
    return `La API de ${name} devolvio un error.`;
  }

  function publicSummary() {
    return {
      id,
      name,
      configured: isConfigured(),
      capabilities: [...capabilities],
      models: {
        text: textModel
      }
    };
  }

  return Object.freeze({
    id,
    name,
    capabilities,
    isConfigured,
    supports,
    modelFor,
    listModels,
    discoverModels,
    credential,
    endpoint,
    authHeaders,
    buildTextRequest,
    buildStructuredRequest,
    extractText,
    requestPolicy,
    retryDecision,
    networkRetryDelay,
    errorMessage,
    publicSummary
  });
}

module.exports = {
  createResponsesCompatibleProvider,
  normalizeIdentifier,
  normalizeModel,
  normalizeBaseUrl,
  normalizeInteger
};
