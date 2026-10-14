"use strict";
const { normalizeCapabilities } = require("../provider-contract");
const {
  getOpenAiRetryDecision,
  getOpenAiNetworkRetryDelay
} = require("./retry-policy");

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function normalizeApiKey(value) {
  const key = String(value || "").trim();
  if (!key || key === "pon-tu-clave-aqui") return "";
  return key;
}

function normalizeModel(value, fallback) {
  const model = String(value || fallback || "").trim();
  if (!model || model.length > 160) throw new Error("Invalid OpenAI model id.");
  return model;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("OpenAI base URL must use HTTPS.");
  if (url.username || url.password) throw new Error("OpenAI base URL must not contain credentials.");
  return url.toString().replace(/\/$/, "");
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createOpenAIProvider(options = {}) {
  const env = options.env || {};
  const apiKey = normalizeApiKey(env.OPENAI_API_KEY);
  const baseUrl = normalizeBaseUrl(env.OPENAI_BASE_URL);
  const policy = Object.freeze({
    timeoutMs: normalizeInteger(env.OPENAI_TIMEOUT_MS, 120_000, 1_000, 1_800_000),
    maxRetries: normalizeInteger(env.OPENAI_MAX_RETRIES, 2, 0, 5)
  });
  const models = Object.freeze({
    text: normalizeModel(env.OPENAI_TEXT_MODEL, "gpt-5.5"),
    image: normalizeModel(env.OPENAI_IMAGE_MODEL, "gpt-image-2"),
    video: normalizeModel(env.OPENAI_VIDEO_MODEL, "sora-2")
  });
  const capabilities = normalizeCapabilities(["text","reasoning","code","images","structured_json","video"]);

  function isConfigured() { return Boolean(apiKey); }
  function supports(capability) { return capabilities.includes(String(capability || "").trim().toLowerCase()); }
  function modelFor(capability) {
    const key = String(capability || "").trim().toLowerCase();
    if (["text","reasoning","code","structured_json"].includes(key)) return models.text;
    if (key === "images" || key === "image") return models.image;
    if (key === "video") return models.video;
    return "";
  }
  function credential(name = "apiKey") { return name === "apiKey" ? apiKey : ""; }

  function reasoningEffortFor(purpose) {
    return String(
      purpose === "router"
        ? env.OPENAI_ROUTER_REASONING || "low"
        : env.OPENAI_REASONING_EFFORT || "medium"
    ).trim() || "medium";
  }

  function buildTextRequest(input = {}) {
    return {
      endpointName: "responses",
      payload: {
        model: normalizeModel(input.model, models.text),
        reasoning: { effort: reasoningEffortFor(input.purpose) },
        instructions: String(input.instructions || ""),
        input: String(input.input || "")
      }
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
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .map((content) => {
        if (typeof content.text === "string") return content.text;
        if (typeof content.output_text === "string") return content.output_text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function listModels() {
    const available = isConfigured();
    const descriptors = new Map();

    function add(modelId, capabilities, modalities, priority) {
      const key = String(modelId);
      const current = descriptors.get(key);

      if (current) {
        for (const capability of capabilities) {
          if (!current.capabilities.includes(capability)) {
            current.capabilities.push(capability);
          }
        }
        for (const modality of modalities) {
          if (!current.modalities.includes(modality)) {
            current.modalities.push(modality);
          }
        }
        current.priority = Math.min(current.priority, priority);
        return;
      }

      descriptors.set(key, {
        id: modelId,
        provider: "openai",
        capabilities: [...capabilities],
        modalities: [...modalities],
        status: available ? "available" : "unconfigured",
        priority,
        contextWindow: null,
        inputCostPerMillion: null,
        outputCostPerMillion: null,
        qualityScore: null,
        latencyMs: null,
        errorRate: null,
        available,
        toolCompatible: capabilities.includes("tools"),
        source: "configured",
        metadata: {
          discovered: false
        }
      });
    }

    add(models.text, ["text","reasoning","code","structured_json"], ["text"], 10);
    add(models.image, ["images"], ["image"], 20);
    add(models.video, ["video"], ["video"], 30);

    return Array.from(descriptors.values());
  }

  function endpoint(name, params = {}) {
    const key = String(name || "").trim().toLowerCase();
    if (key === "responses") return `${baseUrl}/responses`;
    if (key === "images") return `${baseUrl}/images/generations`;
    if (key === "videos") return `${baseUrl}/videos`;

    const videoId = String(params.videoId || "").trim();
    if ((key === "video_status" || key === "video_content") && !videoId) {
      throw new Error("OpenAI video endpoint requires videoId.");
    }
    if (key === "video_status") return `${baseUrl}/videos/${encodeURIComponent(videoId)}`;
    if (key === "video_content") return `${baseUrl}/videos/${encodeURIComponent(videoId)}/content`;
    throw new Error(`Unsupported OpenAI endpoint: ${name}`);
  }

  function authHeaders(extra = {}) {
    if (!apiKey) throw new Error("OpenAI provider is not configured.");
    return { Authorization: `Bearer ${apiKey}`, ...extra };
  }

  async function retryDecision({ response, attempt = 0 } = {}) {
    if (!response) return { retry:false, delayMs:0, reason:"missing_response" };
    let errorCode = "";
    let errorType = "";

    if (!response.ok) {
      try {
        const data = await response.clone().json();
        errorCode = data?.error?.code || "";
        errorType = data?.error?.type || "";
      } catch {}
    }

    return getOpenAiRetryDecision({
      status: response.status,
      errorCode,
      errorType,
      retryAfter: response.headers?.get?.("retry-after") || "",
      attempt
    });
  }

  function requestPolicy() {
    return policy;
  }

  function networkRetryDelay(attempt) {
    return getOpenAiNetworkRetryDelay(attempt);
  }

  function errorMessage(data) {
    if (data?.error?.message) return data.error.message;
    return "La API de OpenAI devolvio un error.";
  }

  function publicSummary() {
    return {
      id:"openai",
      name:"OpenAI",
      configured:isConfigured(),
      capabilities:[...capabilities],
      models:{...models}
    };
  }

  return Object.freeze({
    id:"openai",
    name:"OpenAI",
    capabilities,
    isConfigured,
    supports,
    modelFor,
    listModels,
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
  createOpenAIProvider,
  normalizeApiKey,
  normalizeModel,
  normalizeBaseUrl,
  normalizeInteger
};
