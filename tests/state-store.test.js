"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStateStore, normalizeMode } = require("../src/storage/state-store");
const { createSupabaseStateStore } = require("../src/storage/supabase-state-store");

test("state store mode validation is strict", () => {
  assert.equal(normalizeMode("AUTO"), "auto");
  assert.equal(normalizeMode("local"), "local");
  assert.throws(() => normalizeMode("unknown"));
});

test("local state store preserves history with atomic file replacement", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-state-"));
  const store = createStateStore({ mode: "local", dataDir: dir });

  await store.appendHistory({ id: "1", mode: "text", status: "ok" });
  await store.appendHistory({ id: "2", mode: "image", status: "ok" });

  assert.deepEqual(
    await store.loadHistory(2),
    [
      { id: "2", mode: "image", status: "ok" },
      { id: "1", mode: "text", status: "ok" }
    ]
  );

  assert.equal(store.summary().provider, "local");
  assert.equal(store.summary().durable, false);
});

test("auto mode selects local store without complete Supabase credentials", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-state-"));
  const store = createStateStore({
    mode: "auto",
    dataDir: dir,
    supabaseUrl: "https://example.supabase.co"
  });

  assert.equal(store.provider, "local");
});

test("explicit Supabase mode fails closed when credentials are missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-state-"));
  assert.throws(() =>
    createStateStore({
      mode: "supabase",
      dataDir: dir,
      supabaseUrl: "https://example.supabase.co"
    })
  );
});

test("Supabase state store writes history with server secret headers and upsert", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 201 });
  };

  const store = createSupabaseStateStore({
    url: "https://example.supabase.co",
    secretKey: "sb_secret_test_value",
    table: "ai_state_events",
    namespace: "ia-prod",
    fetchImpl
  });

  await store.appendHistory({ id: "evt-1", mode: "text", status: "ok" });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rest\/v1\/ai_state_events\?/);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, "sb_secret_test_value");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sb_secret_test_value");
  assert.match(calls[0].init.headers.Prefer, /merge-duplicates/);

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.namespace, "ia-prod");
  assert.equal(payload.kind, "history");
  assert.equal(payload.event_id, "evt-1");

  const summary = store.summary();
  assert.equal(summary.durable, true);
  assert.equal(JSON.stringify(summary).includes("sb_secret"), false);
});

test("Supabase state store reads ordered history payloads", async () => {
  const fetchImpl = async (url, init) => {
    assert.match(url, /kind=eq\.history/);
    assert.match(url, /order=created_at\.desc/);
    assert.equal(init.method, "GET");
    return new Response(
      JSON.stringify([
        { payload: { id: "2", mode: "image" } },
        { payload: { id: "1", mode: "text" } }
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  };

  const store = createSupabaseStateStore({
    url: "https://example.supabase.co",
    secretKey: "sb_secret_test_value",
    namespace: "ia-prod",
    fetchImpl
  });

  assert.deepEqual(await store.loadHistory(2), [
    { id: "2", mode: "image" },
    { id: "1", mode: "text" }
  ]);
});
