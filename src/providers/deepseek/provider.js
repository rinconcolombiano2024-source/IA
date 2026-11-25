"use strict";
const { createResponsesCompatibleProvider, normalizeModel } = require("../openai-compatible/responses-provider");

function createDeepSeekProvider({ env = {} } = {}) {
  const model = env.DEEPSEEK_TEXT_MODEL || "deepseek-flash";
  const base = createResponsesCompatibleProvider({
    id: "deepseek", name: "DeepSeek", apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    defaultModel: "deepseek-flash", textModel: model,
    modelPriority: env.DEEPSEEK_MODEL_PRIORITY || 60,
    timeoutMs: env.DEEPSEEK_TIMEOUT_MS || 120000, maxRetries: 0,
    capabilities: ["text", "reasoning"],
    retryDecision: async () => ({ retry: false }),
    networkRetryDelay: () => 0
  });
  function buildTextRequest(input = {}) {
    return { endpointName: "chat", payload: {
      model: normalizeModel(input.model, model),
      messages: [
        { role: "system", content: String(input.instructions || "Responde al usuario.") },
        { role: "user", content: String(input.input || "") }
      ],
      stream: false, max_tokens: 4096
    }};
  }
  return Object.freeze({
    ...base,
    endpoint(name) {
      if (name === "chat") return base.endpoint("responses").replace(/\/responses$/, "/chat/completions");
      return base.endpoint(name);
    },
    buildTextRequest,
    buildStructuredRequest() { throw new Error("DeepSeek structured schema is not enabled."); },
    extractText(data) { return String(data?.choices?.[0]?.message?.content || "").trim(); },
    async discoverModels() { return base.listModels(); }
  });
}
module.exports = { createDeepSeekProvider };
