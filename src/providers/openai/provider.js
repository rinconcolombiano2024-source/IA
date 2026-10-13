"use strict";
const { normalizeCapabilities } = require("../provider-contract");
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
function createOpenAIProvider(options = {}) {
  const env = options.env || {};
  const apiKey = normalizeApiKey(env.OPENAI_API_KEY);
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
  function publicSummary() {
    return { id:"openai", name:"OpenAI", configured:isConfigured(), capabilities:[...capabilities], models:{...models} };
  }
  return Object.freeze({ id:"openai", name:"OpenAI", capabilities, isConfigured, supports, modelFor, credential, publicSummary });
}
module.exports = { createOpenAIProvider, normalizeApiKey, normalizeModel };
