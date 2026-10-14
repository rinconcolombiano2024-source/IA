"use strict";

const { normalizeCapabilities } = require("../provider-contract");
const {
  getAnthropicRetryDecision,
  getAnthropicNetworkRetryDelay
} = require("./retry-policy");

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_VERSION = "2023-06-01";

function normalizeApiKey(value) {
  return String(value || "").trim();
}

function normalizeModel(value, fallback = DEFAULT_MODEL) {
  const model = String(value || fallback || "").trim();
  if (!model || model.length > 160) {
    throw new Error("Invalid Anthropic model id.");
  }
  return model;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(raw);

  if (url.protocol !== "https:") {
    throw new Error("Anthropic base URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Anthropic base URL must not contain credentials.");
  }

  return url.toString().replace(/\/$/, "");
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createAnthropicProvider(options = {}) {
  const env = options.env || {};
  const apiKey = normalizeApiKey(env.ANTHROPIC_API_KEY);
  const baseUrl = normalizeBaseUrl(env.ANTHROPIC_BASE_URL);
  const version = String(env.ANTHROPIC_VERSION || DEFAULT_VERSION).trim() || DEFAULT_VERSION;
  const textModel = normalizeModel(env.ANTHROPIC_TEXT_MODEL, DEFAULT_MODEL);
  const maxTokens = normalizeInteger(env.ANTHROPIC_MAX_TOKENS, 4096, 1, 100_000);
  const modelPriority = normalizeInteger(env.ANTHROPIC_MODEL_PRIORITY, 20, 0, 1000);
  const policy = Object.freeze({
    timeoutMs: normalizeInteger(env.ANTHROPIC_TIMEOUT_MS, 120_000, 1_000, 1_800_000),
    maxRetries: normalizeInteger(env.ANTHROPIC_MAX_RETRIES, 2, 0, 5)
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

  function endpoint(name, params = {}) {
    const key = String(name || "").trim().toLowerCase();
    if (key === "messages") return `${baseUrl}/messages`;
    if (key === "models") {
      const query = params.query ? `?${String(params.query)}` : "";
      return `${baseUrl}/models${query}`;
    }
    throw new Error(`Unsupported Anthropic endpoint: ${name}`);
  }

  function authHeaders(extra = {}) {
    if (!apiKey) {
      throw new Error("Anthropic provider is not configured.");
    }

    return {
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": version,
      ...extra
    };
  }

  function baseMessagePayload(input = {}) {
    const payload = {
      model: normalizeModel(input.model, textModel),
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: String(input.input || "")
        }
      ]
    };

    const instructions = String(input.instructions || "").trim();
    if (instructions) payload.system = instructions;
    return payload;
  }

  function buildTextRequest(input = {}) {
    return {
      endpointName: "messages",
      payload: baseMessagePayload(input)
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

    const payload = baseMessagePayload(input);
    payload.output_config = {
      format: {
        type: "json_schema",
        schema: input.schema
      }
    };

    return {
      endpointName: "messages",
      payload
    };
  }

  function extractText(data) {
    if (!Array.isArray(data?.content)) return "";
    return data.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  function listModels() {
    const available = isConfigured();
    return [{
      id: textModel,
      provider: "anthropic",
      capabilities: [...capabilities],
      modalities: ["text"],
      status: available ? "available" : "unconfigured",
      priority: modelPriority,
      contextWindow: null,
      inputCostPerMillion: null,
      outputCostPerMillion: null,
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
      throw new Error("Anthropic model discovery requires fetch.");
    }

    const query = new URLSearchParams({
      lifecycle: "active",
      limit: "100"
    }).toString();

    const response = await fetchImpl(endpoint("models", { query }), {
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

        const discoveredCapabilities = ["text"];
        if (item?.capabilities?.thinking?.supported === true) {
          discoveredCapabilities.push("reasoning");
        }
        if (
          item?.capabilities?.structured_outputs?.supported === true ||
          item?.capabilities?.structured_output?.supported === true
        ) {
          discoveredCapabilities.push("structured_json");
        }

        if (id === textModel) {
          for (const capability of capabilities) {
            if (!discoveredCapabilities.includes(capability)) {
              discoveredCapabilities.push(capability);
            }
          }
        }

        return {
          id,
          provider: "anthropic",
          capabilities: discoveredCapabilities,
          modalities: ["text"],
          status: String(item?.lifecycle || "available").toLowerCase(),
          priority: id === textModel ? modelPriority : 100,
          contextWindow: Number.isFinite(Number(item?.context_window))
            ? Number(item.context_window)
            : null,
          inputCostPerMillion: null,
          outputCostPerMillion: null,
          qualityScore: null,
          latencyMs: null,
          errorRate: null,
          available: true,
          toolCompatible: Boolean(item?.capabilities?.tools?.supported),
          source: "discovered",
          metadata: {
            discovered: true,
            displayName: String(item?.display_name || ""),
            createdAt: String(item?.created_at || "")
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

    let errorCode = "";
    if (!response.ok) {
      try {
        const data = await response.clone().json();
        errorCode = String(data?.error?.details?.error_code || "");
      } catch {}
    }

    return getAnthropicRetryDecision({
      status: response.status,
      errorCode,
      retryAfter: response.headers?.get?.("retry-after") || "",
      shouldRetry: response.headers?.get?.("x-should-retry") || "",
      attempt
    });
  }

  function networkRetryDelay(attempt) {
    return getAnthropicNetworkRetryDelay(attempt);
  }

  function errorMessage(data) {
    if (data?.error?.message) return String(data.error.message);
    return "La API de Anthropic devolvio un error.";
  }

  function publicSummary() {
    return {
      id: "anthropic",
      name: "Anthropic",
      configured: isConfigured(),
      capabilities: [...capabilities],
      models: {
        text: textModel
      }
    };
  }

  return Object.freeze({
    id: "anthropic",
    name: "Anthropic",
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
  DEFAULT_VERSION,
  createAnthropicProvider,
  normalizeApiKey,
  normalizeModel,
  normalizeBaseUrl,
  normalizeInteger
};
