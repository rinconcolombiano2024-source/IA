"use strict";

function parsePositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createRuntimeGuard(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const windowMs = parsePositiveInteger(options.windowMs, 60_000, 1_000, 86_400_000);
  const maxRuns = parsePositiveInteger(options.maxRuns, 12, 1, 10_000);
  const maxConcurrentRuns = parsePositiveInteger(options.maxConcurrentRuns, 2, 1, 100);
  const maxPromptChars = parsePositiveInteger(options.maxPromptChars, 30_000, 100, 1_000_000);

  let windowStartedAt = now();
  let runCount = 0;
  let activeRuns = 0;

  function refreshWindow(currentTime) {
    if (
      !Number.isFinite(windowStartedAt) ||
      currentTime < windowStartedAt ||
      currentTime - windowStartedAt >= windowMs
    ) {
      windowStartedAt = currentTime;
      runCount = 0;
    }
  }

  function consumeRun() {
    const currentTime = now();
    refreshWindow(currentTime);

    const resetAt = windowStartedAt + windowMs;
    if (runCount >= maxRuns) {
      return {
        allowed: false,
        limit: maxRuns,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - currentTime) / 1000))
      };
    }

    runCount += 1;
    return {
      allowed: true,
      limit: maxRuns,
      remaining: Math.max(0, maxRuns - runCount),
      resetAt,
      retryAfterSeconds: 0
    };
  }

  function tryAcquireRun() {
    if (activeRuns >= maxConcurrentRuns) return false;
    activeRuns += 1;
    return true;
  }

  function releaseRun() {
    if (activeRuns > 0) activeRuns -= 1;
    return activeRuns;
  }

  function validatePrompt(prompt) {
    const text = String(prompt ?? "");
    if (text.length <= maxPromptChars) {
      return { ok: true, length: text.length, maxPromptChars };
    }

    return {
      ok: false,
      code: "PROMPT_TOO_LARGE",
      length: text.length,
      maxPromptChars
    };
  }

  function snapshot() {
    const currentTime = now();
    refreshWindow(currentTime);
    return {
      windowMs,
      maxRuns,
      maxConcurrentRuns,
      maxPromptChars,
      activeRuns,
      remainingRuns: Math.max(0, maxRuns - runCount),
      resetAt: windowStartedAt + windowMs
    };
  }

  return Object.freeze({
    consumeRun,
    tryAcquireRun,
    releaseRun,
    validatePrompt,
    snapshot
  });
}

module.exports = {
  createRuntimeGuard,
  parsePositiveInteger
};
