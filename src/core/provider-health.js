"use strict";

function positiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isProviderHealthFailure(error) {
  if (!error || error.isClientRequestError === true) return false;

  const code = String(error.code || "").trim().toUpperCase();

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

function createProviderHealth(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const failureThreshold = positiveInteger(options.failureThreshold, 3, 1, 20);
  const openMs = positiveInteger(options.openMs, 60_000, 1_000, 3_600_000);
  const latencyTargetMs = positiveInteger(options.latencyTargetMs, 5_000, 100, 120_000);
  const states = new Map();

  function stateFor(providerId) {
    const id = String(providerId || "").trim().toLowerCase();
    if (!id) throw new Error("Provider health requires provider id.");

    if (!states.has(id)) {
      states.set(id, {
        provider: id,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        lastErrorCode: "",
        lastProviderStatus: null,
        openUntil: 0,
        latencyEwmaMs: null
      });
    }

    return states.get(id);
  }

  function updateLatency(state, latencyMs) {
    const latency = Number(latencyMs);
    if (!Number.isFinite(latency) || latency < 0) return;

    state.latencyEwmaMs =
      state.latencyEwmaMs === null
        ? latency
        : Math.round(state.latencyEwmaMs * 0.8 + latency * 0.2);
  }

  function circuitState(providerId) {
    const state = stateFor(providerId);
    const current = now();

    if (state.openUntil > current) return "open";
    if (state.openUntil > 0 && state.consecutiveFailures >= failureThreshold) {
      return "recovering";
    }
    return "closed";
  }

  function canRoute(providerId) {
    return circuitState(providerId) !== "open";
  }

  function score(providerId) {
    const state = stateFor(providerId);
    const total = state.successes + state.failures;
    const ratio = total > 0 ? state.failures / total : 0;
    const consecutivePenalty = Math.min(60, state.consecutiveFailures * 20);
    const ratioPenalty = Math.min(25, Math.round(ratio * 25));
    const latencyPenalty =
      Number.isFinite(state.latencyEwmaMs) && state.latencyEwmaMs > latencyTargetMs
        ? Math.min(
            15,
            Math.round(
              ((state.latencyEwmaMs - latencyTargetMs) / latencyTargetMs) * 10
            )
          )
        : 0;
    const openPenalty = circuitState(providerId) === "open" ? 100 : 0;

    return Math.max(
      0,
      Math.min(
        100,
        100 - consecutivePenalty - ratioPenalty - latencyPenalty - openPenalty
      )
    );
  }

  function recordSuccess(providerId, latencyMs) {
    const state = stateFor(providerId);
    state.successes += 1;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = now();
    state.lastErrorCode = "";
    state.lastProviderStatus = null;
    state.openUntil = 0;
    updateLatency(state, latencyMs);
    return snapshot(providerId);
  }

  function recordFailure(providerId, error, latencyMs) {
    const state = stateFor(providerId);
    updateLatency(state, latencyMs);

    if (!isProviderHealthFailure(error)) {
      return snapshot(providerId);
    }

    state.failures += 1;
    state.consecutiveFailures += 1;
    state.lastFailureAt = now();
    state.lastErrorCode = String(error?.code || "PROVIDER_FAILURE").slice(0, 80);
    state.lastProviderStatus = Number.isFinite(Number(error?.providerStatus))
      ? Number(error.providerStatus)
      : null;

    if (state.consecutiveFailures >= failureThreshold) {
      state.openUntil = now() + openMs;
    }

    return snapshot(providerId);
  }

  function snapshot(providerId) {
    const state = stateFor(providerId);
    const current = now();

    return {
      provider: state.provider,
      circuit: circuitState(providerId),
      score: score(providerId),
      successes: state.successes,
      failures: state.failures,
      consecutiveFailures: state.consecutiveFailures,
      latencyEwmaMs: state.latencyEwmaMs,
      lastSuccessAt: state.lastSuccessAt || null,
      lastFailureAt: state.lastFailureAt || null,
      lastErrorCode: state.lastErrorCode || null,
      lastProviderStatus: state.lastProviderStatus,
      retryAfterMs: state.openUntil > current ? state.openUntil - current : 0
    };
  }

  function summary(providerIds = []) {
    const ids = new Set([
      ...states.keys(),
      ...Array.from(providerIds || [], (value) =>
        String(value || "").trim().toLowerCase()
      ).filter(Boolean)
    ]);

    return Array.from(ids)
      .sort()
      .map((providerId) => snapshot(providerId));
  }

  return Object.freeze({
    failureThreshold,
    openMs,
    latencyTargetMs,
    canRoute,
    score,
    circuitState,
    recordSuccess,
    recordFailure,
    snapshot,
    summary
  });
}

module.exports = {
  createProviderHealth,
  isProviderHealthFailure
};
