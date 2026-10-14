"use strict";

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1","true","yes","on"].includes(normalized)) return true;
  if (["0","false","no","off"].includes(normalized)) return false;
  return fallback;
}

function positiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createTimedFetch(fetchImpl, timeoutMs) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Model discovery requires fetch.");
  }

  return async function timedFetch(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(url, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

function createModelDiscovery(options = {}) {
  const providerRegistry = options.providerRegistry;
  const modelRegistry = options.modelRegistry;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const enabled = normalizeBoolean(options.enabled, true);
  const intervalMs = positiveInteger(
    options.intervalMs,
    15 * 60_000,
    60_000,
    24 * 60 * 60_000
  );
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    5_000,
    500,
    30_000
  );
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!providerRegistry || typeof providerRegistry.list !== "function") {
    throw new Error("Model discovery requires provider registry.");
  }
  if (!modelRegistry || typeof modelRegistry.refreshProvider !== "function") {
    throw new Error("Model discovery requires model registry.");
  }

  let inFlight = null;
  let lastAttemptAt = 0;
  let lastSuccessAt = 0;
  let nextRefreshAt = 0;
  const providerState = new Map();

  function stateFor(providerId) {
    const id = String(providerId || "").trim().toLowerCase();
    if (!providerState.has(id)) {
      providerState.set(id, {
        provider:id,
        status:"idle",
        lastAttemptAt:0,
        lastSuccessAt:0,
        modelCount:0,
        errorCode:null
      });
    }
    return providerState.get(id);
  }

  async function refreshProvider(provider, timedFetch) {
    const state = stateFor(provider.id);
    state.lastAttemptAt = now();

    if (!provider.isConfigured()) {
      state.status = "unconfigured";
      state.errorCode = null;
      return;
    }

    if (typeof provider.discoverModels !== "function") {
      state.status = "unsupported";
      state.errorCode = null;
      return;
    }

    try {
      const refreshed = await modelRegistry.refreshProvider(provider, {
        discover:true,
        discoveryOptions:{
          fetchImpl:timedFetch
        }
      });

      state.status = "ok";
      state.lastSuccessAt = now();
      state.modelCount = refreshed.length;
      state.errorCode = null;
      lastSuccessAt = Math.max(lastSuccessAt, state.lastSuccessAt);
    } catch {
      state.status = "error";
      state.errorCode = "MODEL_DISCOVERY_FAILED";
    }
  }

  async function doRefresh() {
    lastAttemptAt = now();
    nextRefreshAt = lastAttemptAt + intervalMs;

    if (!enabled) {
      return summary();
    }

    const timedFetch = createTimedFetch(fetchImpl, timeoutMs);
    await Promise.all(
      providerRegistry.list().map((provider) =>
        refreshProvider(provider, timedFetch)
      )
    );

    return summary();
  }

  function refreshIfDue(options = {}) {
    const force = options.force === true;

    if (!enabled) {
      return Promise.resolve(summary());
    }

    if (inFlight) return inFlight;

    if (!force && nextRefreshAt > now()) {
      return Promise.resolve(summary());
    }

    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  function summary() {
    return {
      enabled,
      intervalMs,
      timeoutMs,
      inFlight:Boolean(inFlight),
      lastAttemptAt:lastAttemptAt || null,
      lastSuccessAt:lastSuccessAt || null,
      nextRefreshAt:nextRefreshAt || null,
      providers:providerRegistry.list().map((provider) => {
        const state = stateFor(provider.id);
        return {
          provider:state.provider,
          status:state.status,
          lastAttemptAt:state.lastAttemptAt || null,
          lastSuccessAt:state.lastSuccessAt || null,
          modelCount:state.modelCount,
          errorCode:state.errorCode
        };
      })
    };
  }

  return Object.freeze({
    refreshIfDue,
    summary
  });
}

module.exports = {
  createModelDiscovery,
  createTimedFetch,
  normalizeBoolean
};
