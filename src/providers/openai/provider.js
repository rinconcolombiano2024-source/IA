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

function createOpenAIProvider(options = {}) {
  const env = options.env || {};
  const apiKey = normalizeApiKey(env.OPENAI_API_KEY);
  const baseUrl = normalizeBaseUrl(env.OPENAI_BASE_URL);
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
    credential,
    endpoint,
    authHeaders,
    retryDecision,
    networkRetryDelay,
    errorMessage,
    publicSummary
  });
}
module.exports = { DEFAULT_BASE_URL, createOpenAIProvider, normalizeApiKey, normalizeModel, normalizeBaseUrl };
