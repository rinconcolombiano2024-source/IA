"use strict";

function clampAttempt(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(8, parsed));
}

function parseRetryAfter(value, nowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(120_000, Math.ceil(seconds * 1000));
  }

  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, Math.min(120_000, dateMs - nowMs));
}

function backoffDelay(attempt, random = Math.random) {
  const safeAttempt = clampAttempt(attempt);
  const base = Math.min(60_000, 750 * (2 ** safeAttempt));
  const jitter = 0.8 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4;
  return Math.max(250, Math.round(base * jitter));
}

function getGroqRetryDecision(input = {}) {
  const status = Number(input.status || 0);
  const attempt = clampAttempt(input.attempt);

  if ([400,401,403,404,405,413,415,422].includes(status)) {
    return { retry:false, delayMs:0, reason:"client_error" };
  }

  if (status === 408 || status === 429 || status === 498 || status >= 500) {
    const retryAfterMs = parseRetryAfter(input.retryAfter);
    return {
      retry:true,
      delayMs:retryAfterMs ?? backoffDelay(attempt, input.random || Math.random),
      reason:status === 429
        ? "rate_limit"
        : status === 498
          ? "capacity_exceeded"
          : "transient"
    };
  }

  return { retry:false, delayMs:0, reason:"non_retryable" };
}

function getGroqNetworkRetryDelay(attempt, random = Math.random) {
  return backoffDelay(attempt, random);
}

module.exports = {
  parseRetryAfter,
  backoffDelay,
  getGroqRetryDecision,
  getGroqNetworkRetryDelay
};
