"use strict";

const SAFE_FALLBACK_INTENTS = new Set([
  "router",
  "text",
  "document",
  "restaurant",
  "book",
  "code",
  "website",
  "repair"
]);

function isFallbackSafeIntent(intent) {
  return SAFE_FALLBACK_INTENTS.has(
    String(intent || "").trim().toLowerCase()
  );
}

function isFallbackEligibleError(error) {
  if (!error || error.isClientRequestError === true) return false;

  const code = String(error.code || "").trim().toUpperCase();

  if (code === "REQUEST_DEADLINE_EXCEEDED") return false;
  if (code === "PROVIDER_NETWORK_ERROR") return true;
  if (code === "PROVIDER_INVALID_RESPONSE") return true;
  if (code === "UPSTREAM_TIMEOUT") return true;

  if (code === "PROVIDER_HTTP_ERROR") {
    const status = Number(error.providerStatus || 0);
    return (
      status === 401 ||
      status === 403 ||
      status === 408 ||
      status === 409 ||
      status === 429 ||
      status >= 500
    );
  }

  return false;
}

function publicAttempt(selection, error = null) {
  return {
    provider: String(selection?.provider || ""),
    model: String(selection?.id || ""),
    status: error ? "failed" : "ok",
    errorCode: error ? String(error.code || "PROVIDER_FAILURE").slice(0, 80) : null,
    providerStatus:
      error && Number.isFinite(Number(error.providerStatus))
        ? Number(error.providerStatus)
        : null
  };
}

async function executeWithFallback(options = {}) {
  const plan = options.plan;
  const intent = String(options.intent || "").trim().toLowerCase();
  const providerFor = options.providerFor;
  const execute = options.execute;
  const deadline = options.deadline;

  if (!plan || typeof providerFor !== "function" || typeof execute !== "function") {
    throw new Error("Fallback executor requires plan, providerFor and execute.");
  }

  const selections = [
    plan.primary,
    plan.fallback,
    plan.secondFallback
  ].filter(Boolean);

  if (!selections.length) {
    throw new Error("Fallback executor received an empty routing plan.");
  }

  const attempts = [];
  let lastError = null;

  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    const provider = providerFor(selection);

    try {
      const result = await execute({
        provider,
        selection,
        attemptIndex: index
      });

      attempts.push(publicAttempt(selection));
      return {
        result,
        selection,
        fallbackUsed: index > 0,
        attempts
      };
    } catch (error) {
      lastError = error;
      attempts.push(publicAttempt(selection, error));

      const hasNext = index < selections.length - 1;
      const deadlineAllowsAnotherAttempt =
        !deadline ||
        typeof deadline.usableMs !== "function" ||
        deadline.usableMs() >= 1_000;

      const canFallback =
        hasNext &&
        deadlineAllowsAnotherAttempt &&
        isFallbackSafeIntent(intent) &&
        isFallbackEligibleError(error);

      if (!canFallback) {
        error.routingAttempts = attempts;
        throw error;
      }
    }
  }

  if (lastError) {
    lastError.routingAttempts = attempts;
    throw lastError;
  }

  throw new Error("Fallback execution ended without a result.");
}

module.exports = {
  SAFE_FALLBACK_INTENTS,
  isFallbackSafeIntent,
  isFallbackEligibleError,
  executeWithFallback
};
