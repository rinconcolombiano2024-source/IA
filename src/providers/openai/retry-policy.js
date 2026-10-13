"use strict";

const NON_RETRYABLE_429_CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "billing_hard_limit_reached",
  "insufficient_quota"
]);

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function parseRetryAfterMs(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - now);
}

function computeBackoffMs(attempt, options = {}) {
  const baseDelayMs = Number.isFinite(Number(options.baseDelayMs))
    ? Math.max(1, Number(options.baseDelayMs))
    : 700;
  const maxDelayMs = Number.isFinite(Number(options.maxDelayMs))
    ? Math.max(baseDelayMs, Number(options.maxDelayMs))
    : 15_000;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const exponent = Math.max(0, Number(attempt) || 0);
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
  const jitter = Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * baseDelayMs);
  return Math.min(maxDelayMs, exponential + jitter);
}

function getOpenAiRetryDecision(input = {}) {
  const status = Number(input.status) || 0;
  const errorCode = normalizeToken(input.errorCode);
  const errorType = normalizeToken(input.errorType);
  const attempt = Math.max(0, Number(input.attempt) || 0);
  const random = typeof input.random === "function" ? input.random : Math.random;
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();

  if (status === 409) {
    return { retry: false, delayMs: 0, reason: "conflict_requires_state_check" };
  }

  if (status === 429) {
    if (
      NON_RETRYABLE_429_CODES.has(errorCode) ||
      errorType === "insufficient_quota"
    ) {
      return { retry: false, delayMs: 0, reason: "quota_or_billing" };
    }

    const retryAfterMs = parseRetryAfterMs(input.retryAfter, now);
    if (retryAfterMs !== null) {
      const jitterMs = Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * 250);
      return {
        retry: true,
        delayMs: retryAfterMs + jitterMs,
        reason: "temporary_rate_limit_retry_after"
      };
    }

    return {
      retry: true,
      delayMs: computeBackoffMs(attempt, { random }),
      reason: "temporary_rate_limit_backoff"
    };
  }

  if (status === 408 || status >= 500) {
    const retryAfterMs = parseRetryAfterMs(input.retryAfter, now);
    if (retryAfterMs !== null) {
      const jitterMs = Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * 250);
      return {
        retry: true,
        delayMs: retryAfterMs + jitterMs,
        reason: "transient_server_retry_after"
      };
    }

    return {
      retry: true,
      delayMs: computeBackoffMs(attempt, { random }),
      reason: "transient_server_backoff"
    };
  }

  return { retry: false, delayMs: 0, reason: "not_retryable" };
}

function getOpenAiNetworkRetryDelay(attempt, options = {}) {
  return computeBackoffMs(attempt, options);
}

module.exports = {
  NON_RETRYABLE_429_CODES,
  parseRetryAfterMs,
  computeBackoffMs,
  getOpenAiRetryDecision,
  getOpenAiNetworkRetryDelay
};
