"use strict";

const { createLocalStateStore } = require("./local-state-store");
const { createSupabaseStateStore } = require("./supabase-state-store");

function normalizeMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  if (!["auto", "local", "supabase"].includes(mode)) {
    throw new Error("AI_STATE_STORE must be auto, local, or supabase.");
  }
  return mode;
}

function createStateStore(options = {}) {
  const mode = normalizeMode(options.mode);
  const hasSupabaseConfig = Boolean(
    String(options.supabaseUrl || "").trim() &&
    String(options.supabaseSecretKey || "").trim()
  );

  if (mode === "supabase" && !hasSupabaseConfig) {
    throw new Error(
      "AI_STATE_STORE=supabase requires AI_SUPABASE_URL and AI_SUPABASE_SECRET_KEY."
    );
  }

  if (mode === "supabase" || (mode === "auto" && hasSupabaseConfig)) {
    return createSupabaseStateStore({
      url: options.supabaseUrl,
      secretKey: options.supabaseSecretKey,
      table: options.supabaseTable,
      namespace: options.namespace,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    });
  }

  return createLocalStateStore({
    dataDir: options.dataDir
  });
}

module.exports = {
  createStateStore,
  normalizeMode
};
