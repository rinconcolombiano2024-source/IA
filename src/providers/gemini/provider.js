"use strict";

const { normalizeCapabilities } = require("../provider-contract");
const {
  getGeminiRetryDecision,
  getGeminiNetworkRetryDelay
} = require("./retry-policy");

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_CLIENT_HEADER = "rincon-colombiano-ia/2.0.0";

function normalizeApiKey(value) {
  return String(value || "").trim();
}

function normalizeModel(value, fallback = DEFAULT_MODEL) {
  const raw = String(value || fallback || "").trim();
  const model = raw.replace(/^models\//, "");
  if (!model || model.length > 160 || !/^[a-zA-Z0-9._:-]+$/.test(model)) {
    throw new Error("Invalid Gemini model id.");
  }
  return model;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(raw);

  if (url.protocol !== "https:") {
    throw new Error("Gemini base URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Gemini base URL must not contain credentials.");
  }

  return url.toString().replace(/\/$/, "");
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createGeminiProvider(options = {}) {
  const env = options.env || {};
  const apiKey = normalizeApiKey(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  const baseUrl = normalizeBaseUrl(env.GEMINI_BASE_URL);
  const textModel = normalizeModel(env.GEMINI_TEXT_MODEL, DEFAULT_MODEL);
  const maxOutputTokens = normalizeInteger(env.GEMINI_MAX_OUTPUT_TOKENS, 8192, 1, 131_072);
  const modelPriority = normalizeInteger(env.GEMINI_MODEL_PRIORITY, 30, 0, 1000);
  const clientHeader =
    String(env.GEMINI_API_CLIENT || DEFAULT_CLIENT_HEADER).trim() ||
    DEFAULT_CLIENT_HEADER;
  const policy = Object.freeze({
    timeoutMs: normalizeInteger(env.GEMINI_TIMEOUT_MS, 120_000, 1_000, 1_800_000),
    maxRetries: normalizeInteger(env.GEMINI_MAX_RETRIES, 2, 0, 5)
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

    if (key === "generate_content") {
      const modelId = normalizeModel(params.model || textModel, textModel);
      return `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
    }

    if (key === "models") {
      const query = params.query ? `?${String(params.query)}` : "";
      return `${baseUrl}/models${query}`;
    }

    throw new Error(`Unsupported Gemini endpoint: ${name}`);
  }

  function authHeaders(extra = {}) {
    if (!apiKey) {
      throw new Error("Gemini provider is not configured.");
    }

    return {
      "x-goog-api-key": apiKey,
      "x-goog-api-client": clientHeader,
      ...extra
    };
  }

  function basePayload(input = {}) {
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: String(input.input || "") }]
        }
      ],
      generationConfig: {
        maxOutputTokens
      }
    };

    const instructions = String(input.instructions || "").trim();
    if (instructions) {
      payload.systemInstruction = {
        parts: [{ text: instructions }]
      };
    }

    return payload;
  }

  function buildTextRequest(input = {}) {
    const model = normalizeModel(input.model, textModel);
    return {
      endpointName: "generate_content",
      endpointParams: { model },
      payload: basePayload(input)
    };
  }

  function buildStructuredRequest(input = {}) {
    if (!input.schema || typeof input.schema !== "object") {
      throw new Error("Structured output requires a JSON schema.");
    }

    const request = buildTextRequest(input);
    request.payload.generationConfig.responseFormat = {
      text: {
        mimeType: "APPLICATION_JSON",
        schema: input.schema
      }
    };
    return request;
  }

  function extractText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    return candidates
      .flatMap((candidate) =>
        Array.isArray(candidate?.content?.parts)
          ? candidate.content.parts
          : []
      )
      .filter(
        (part) =>
          part?.thought !== true &&
          typeof part?.text === "string"
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
  }

  function listModels() {
    const available = isConfigured();
    return [{
      id: textModel,
      provider: "gemini",
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
      throw new Error("Gemini model discovery requires fetch.");
    }

    const query = new URLSearchParams({
      pageSize: "1000"
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

    const discovered = Array.isArray(data?.models) ? data.models : [];
    const descriptors = discovered
      .map((item) => {
        const idSource = item?.baseModelId || item?.name || "";
        let id;
        try {
          id = normalizeModel(idSource);
        } catch {
          return null;
        }

        const actions = [
          ...(Array.isArray(item?.supportedGenerationMethods)
            ? item.supportedGenerationMethods
            : []),
          ...(Array.isArray(item?.supportedActions)
            ? item.supportedActions
            : [])
        ].map((value) => String(value).toLowerCase());

        if (
          actions.length &&
          !actions.some((value) => value.toLowerCase() === "generatecontent")
        ) {
          return null;
        }

        const discoveredCapabilities = ["text"];
        if (id === textModel) {
          for (const capability of capabilities) {
            if (!discoveredCapabilities.includes(capability)) {
              discoveredCapabilities.push(capability);
            }
          }
        }

        return {
          id,
          provider: "gemini",
          capabilities: discoveredCapabilities,
          modalities: ["text"],
          status: "available",
          priority: id === textModel ? modelPriority : 100,
          contextWindow: Number.isFinite(Number(item?.inputTokenLimit))
            ? Number(item.inputTokenLimit)
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
            displayName: String(item?.displayName || ""),
            version: String(item?.version || ""),
            outputTokenLimit: Number.isFinite(Number(item?.outputTokenLimit))
              ? Number(item.outputTokenLimit)
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

    let errorCode = "";
    if (!response.ok) {
      try {
        const data = await response.clone().json();
        errorCode = String(
          data?.error?.status ||
          data?.error?.code ||
          ""
        );
      } catch {}
    }

    return getGeminiRetryDecision({
      status: response.status,
      errorCode,
      retryAfter: response.headers?.get?.("retry-after") || "",
      attempt
    });
  }

  function networkRetryDelay(attempt) {
    return getGeminiNetworkRetryDelay(attempt);
  }

  function errorMessage(data) {
    if (data?.error?.message) return String(data.error.message);
    return "La API de Gemini devolvio un error.";
  }

  function publicSummary() {
    return {
      id: "gemini",
      name: "Google Gemini",
      configured: isConfigured(),
      capabilities: [...capabilities],
      models: {
        text: textModel
      }
    };
  }

  return Object.freeze({
    id: "gemini",
    name: "Google Gemini",
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
  DEFAULT_CLIENT_HEADER,
  createGeminiProvider,
  normalizeApiKey,
  normalizeModel,
  normalizeBaseUrl,
  normalizeInteger
};
