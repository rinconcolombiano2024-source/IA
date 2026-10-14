"use strict";

const {
  createResponsesCompatibleProvider
} = require("../openai-compatible/responses-provider");
const {
  getGroqRetryDecision,
  getGroqNetworkRetryDelay
} = require("./retry-policy");

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createGroqProvider(options = {}) {
  const env = options.env || {};

  return createResponsesCompatibleProvider({
    id: "groq",
    name: "Groq",
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL || DEFAULT_BASE_URL,
    textModel: env.GROQ_TEXT_MODEL || DEFAULT_MODEL,
    defaultModel: DEFAULT_MODEL,
    modelPriority: normalizeInteger(env.GROQ_MODEL_PRIORITY, 50, 0, 1000),
    timeoutMs: normalizeInteger(env.GROQ_TIMEOUT_MS, 120_000, 1_000, 1_800_000),
    maxRetries: normalizeInteger(env.GROQ_MAX_RETRIES, 2, 0, 5),
    capabilities: [
      "text",
      "reasoning",
      "code",
      "structured_json"
    ],
    exactMetadata: {
      "openai/gpt-oss-120b": {
        contextWindow: 131_072,
        inputCostPerMillion: 0.15,
        outputCostPerMillion: 0.60,
        toolCompatible: true
      }
    },
    retryDecision: async ({ response, attempt = 0 } = {}) =>
      getGroqRetryDecision({
        status: response?.status || 0,
        retryAfter: response?.headers?.get?.("retry-after") || "",
        attempt
      }),
    networkRetryDelay: getGroqNetworkRetryDelay
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  createGroqProvider,
  normalizeInteger
};
