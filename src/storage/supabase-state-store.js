"use strict";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Supabase state store requires a project URL.");

  const url = new URL(raw);
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new Error("Supabase state store requires HTTPS, except localhost development.");
  }

  if (url.username || url.password) {
    throw new Error("Supabase project URL must not contain credentials.");
  }

  return url.toString().replace(/\/$/, "");
}

function normalizeIdentifier(value, fallback) {
  const text = String(value || fallback || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(text)) {
    throw new Error("Invalid Supabase table identifier.");
  }
  return text;
}

function normalizeNamespace(value) {
  const text = String(value || "default").trim();
  if (!/^[a-zA-Z0-9_.:-]{1,96}$/.test(text)) {
    throw new Error("Invalid state namespace.");
  }
  return text;
}

function clampLimit(value, fallback = 20, max = 200) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function clampTimeout(value, fallback = 5_000) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30_000, Math.max(1_000, parsed));
}

function createSupabaseStateStore(options = {}) {
  const baseUrl = normalizeBaseUrl(options.url);
  const secretKey = String(options.secretKey || "").trim();
  const table = normalizeIdentifier(options.table, "ai_state_events");
  const namespace = normalizeNamespace(options.namespace);
  const timeoutMs = clampTimeout(options.timeoutMs);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!secretKey) {
    throw new Error("Supabase state store requires a server-side secret key.");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Supabase state store requires fetch.");
  }

  const endpoint = `${baseUrl}/rest/v1/${table}`;

  function headers(extra = {}) {
    return {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...extra
    };
  }

  async function request(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: headers(init.headers),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(`Supabase state store HTTP ${response.status}.`);
        error.code = "STATE_STORE_HTTP_ERROR";
        error.status = response.status;
        error.detail = body.slice(0, 1000);
        throw error;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadHistory(limit = 20) {
    const safeLimit = clampLimit(limit);
    const params = new URLSearchParams({
      namespace: `eq.${namespace}`,
      kind: "eq.history",
      select: "payload",
      order: "created_at.desc",
      limit: String(safeLimit)
    });

    const response = await request(`${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => row?.payload).filter(Boolean);
  }

  async function appendHistory(entry) {
    const eventId = String(entry?.id || "").trim();
    if (!eventId) {
      throw new Error("Persistent history entry requires an id.");
    }

    const params = new URLSearchParams({
      on_conflict: "namespace,kind,event_id"
    });

    await request(`${endpoint}?${params.toString()}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        namespace,
        kind: "history",
        event_id: eventId.slice(0, 128),
        payload: entry
      })
    });
  }

  function summary() {
    return {
      provider: "supabase",
      durable: true,
      scope: "shared",
      namespace,
      table
    };
  }

  return Object.freeze({
    provider: "supabase",
    durable: true,
    loadHistory,
    appendHistory,
    summary
  });
}

module.exports = {
  createSupabaseStateStore,
  normalizeBaseUrl,
  normalizeIdentifier,
  normalizeNamespace,
  clampLimit,
  clampTimeout
};
