"use strict";

const { normalizeCapabilities } = require("../provider-contract");
const {
  getXaiRetryDecision,
  getXaiNetworkRetryDelay
} = require("./retry-policy");

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4.7";

function normalizeApiKey(value) {
  return String(value || "").trim();
}

function normalizeModel(value, fallback = DEFAULT_MODEL) {
  const model = String(value || fallback || "").trim();
  if (!model || model.length > 160 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    throw new Error("Invalid xAI model id.");
  }
  return model;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("xAI base URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("xAI base URL must not contain credentials.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeReasoningEffort(value, fallback = "high") {
  const allowed = new Set(["low","medium","high","xhigh"]);
  const effort = String(value || fallback).trim().toLowerCase();
  return allowed.has(effort) ? effort : fallback;
}

function createXaiProvider(options = {}) {
  const env = options.env || {};
  const apiKey = normalizeApiKey(env.XAI_API_KEY);
  const baseUrl = normalizeBaseUrl(env.XAI_BASE_URL);
  const textModel = normalizeModel(env.XAI_TEXT_MODEL, DEFAULT_MODEL);
  const modelPriority = normalizeInteger(env.XAI_MODEL_PRIORITY, 40, 0, 1000);
  const reasoningEffort = normalizeReasoningEffort(env.XAI_REASONING_EFFORT, "high");
  const policy = Object.freeze({
    timeoutMs: normalizeInteger(env.XAI_TIMEOUT_MS, 360_000, 1_000, 3_600_000),
    maxRetries: normalizeInteger(env.XAI_MAX_RETRIES, 2, 0, 5)
  });
  const capabilities = normalizeCapabilities([
    "text",
    "reasoning",
    "code",
    "structured_json"
  ]);

  function isConfigured() {
    return Boolean(apiKey);
  }

  function supports(capability) {
    return capabilities.includes(String(capability || "").trim().toLowerCase());
  }

  function modelFor(capability) {
    const key = String(capability || "").trim().toLowerCase();
    if (["text","reasoning","code","structured_json"].includes(key)) {
      return textModel;
    }
    return "";
  }

  function credential(name = "apiKey") {
    return name === "apiKey" ? apiKey : "";
  }

  function endpoint(name) {
    const key = String(name || "").trim().toLowerCase();
    if (key === "responses") return `${baseUrl}/responses`;
    if (key === "models") return `${baseUrl}/models`;
    if (key === "language_models") return `${baseUrl}/language-models`;
    throw new Error(`Unsupported xAI endpoint: ${name}`);
  }

  function authHeaders(extra = {}) {
    if (!apiKey) {
      throw new Error("xAI provider is not configured.");
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

    if (
      input.purpose === "repair" ||
      input.purpose === "code" ||
      input.purpose === "general"
    ) {
      payload.reasoning = {
        effort: reasoningEffort
      };
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

  function listModels() {
    const available = isConfigured();
    return [{
      id: textModel,
      provider: "xai",
      capabilities: [...capabilities],
      modalities: ["text"],
      status: available ? "available" : "unconfigured",
      priority: modelPriority,
      contextWindow: textModel === "grok-4.7" ? 500_000 : null,
      inputCostPerMillion: textModel === "grok-4.7" ? 2 : null,
      outputCostPerMillion: textModel === "grok-4.7" ? 6 : null,
      qualityScore: null,
      latencyMs: null,
      errorRate: null,
      available,
      toolCompatible: false,
      source: "configured",
      metadata: {
        discovered: false
      }
    }];
  }

  async function discoverModels(options = {}) {
    if (!isConfigured()) return listModels();

    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("xAI model discovery requires fetch.");
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

    const discovered = Array.isArray(data?.data) ? data.data : [];
    const descriptors = discovered
      .map((item) => {
        const id = String(item?.id || "").trim();
        if (!id) return null;

        const configured = id === textModel;
        return {
          id,
          provider: "xai",
          capabilities: configured ? [...capabilities] : ["text"],
          modalities: ["text"],
          status: "available",
          priority: configured ? modelPriority : 100,
          contextWindow: Number.isFinite(Number(item?.context_length))
            ? Number(item.context_length)
            : null,
          inputCostPerMillion: null,
          outputCostPerMillion: null,
          qualityScore: null,
          latencyMs: null,
          errorRate: null,
          available: true,
          toolCompatible: false,
          source: "discovered",
          metadata: {
            discovered: true,
            ownedBy: String(item?.owned_by || ""),
            created: Number.isFinite(Number(item?.created))
              ? Number(item.created)
              : null
          }
        };
      })
      .filter(Boolean);

    return descriptors.length ? descriptors : listModels();
  }

  function requestPolicy() {
    return policy;
  }

  async function retryDecision({ response, attempt = 0 } = {}) {
    if (!response) {
      return { retry:false, delayMs:0, reason:"missing_response" };
    }
    return getXaiRetryDecision({
      status: response.status,
      retryAfter: response.headers?.get?.("retry-after") || "",
      attempt
    });
  }

  function networkRetryDelay(attempt) {
    return getXaiNetworkRetryDelay(attempt);
  }

  function errorMessage(data) {
    if (data?.error?.message) return String(data.error.message);
    return "La API de xAI devolvio un error.";
  }

  function publicSummary() {
    return {
      id: "xai",
      name: "xAI",
      configured: isConfigured(),
      capabilities: [...capabilities],
      models: {
        text: textModel
      }
    };
  }

  return Object.freeze({
    id: "xai",
    name: "xAI",
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
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  createXaiProvider,
  normalizeApiKey,
  normalizeModel,
  normalizeBaseUrl,
  normalizeInteger,
  normalizeReasoningEffort
};
