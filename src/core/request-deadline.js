"use strict";

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createRequestDeadline(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const deadlineMs = clampInteger(options.deadlineMs, 280_000, 10_000, 1_800_000);
  const requestedReserveMs = clampInteger(options.responseReserveMs, 2_000, 500, 30_000);
  const responseReserveMs = Math.min(requestedReserveMs, Math.max(500, deadlineMs - 1_000));
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;

  function remainingMs() {
    return Math.max(0, deadlineAt - now());
  }

  function usableMs() {
    return Math.max(0, remainingMs() - responseReserveMs);
  }

  function attemptTimeoutMs(maxAttemptMs) {
    const maxMs = clampInteger(maxAttemptMs, 120_000, 1_000, 1_800_000);
    return Math.max(0, Math.min(maxMs, usableMs()));
  }

  function canWait(delayMs, minimumAfterWaitMs = 1_000) {
    const delay = Math.max(0, Number(delayMs) || 0);
    const minimum = Math.max(0, Number(minimumAfterWaitMs) || 0);
    return usableMs() > delay + minimum;
  }

  function snapshot() {
    return {
      startedAt,
      deadlineAt,
      deadlineMs,
      responseReserveMs,
      remainingMs: remainingMs(),
      usableMs: usableMs()
    };
  }

  return Object.freeze({
    remainingMs,
    usableMs,
    attemptTimeoutMs,
    canWait,
    snapshot
  });
}

module.exports = {
  createRequestDeadline,
  clampInteger
};
