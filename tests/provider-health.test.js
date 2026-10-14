"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProviderHealth,
  isProviderHealthFailure
} = require("../src/core/provider-health");

function providerError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status !== undefined) error.providerStatus = status;
  return error;
}

test("provider health only counts provider/upstream failures", () => {
  assert.equal(isProviderHealthFailure(providerError("PROVIDER_NETWORK_ERROR")), true);
  assert.equal(isProviderHealthFailure(providerError("PROVIDER_INVALID_RESPONSE")), true);
  assert.equal(isProviderHealthFailure(providerError("UPSTREAM_TIMEOUT")), true);
  assert.equal(isProviderHealthFailure(providerError("PROVIDER_HTTP_ERROR", 503)), true);
  assert.equal(isProviderHealthFailure(providerError("PROVIDER_HTTP_ERROR", 429)), true);
  assert.equal(isProviderHealthFailure(providerError("PROVIDER_HTTP_ERROR", 400)), false);
  assert.equal(isProviderHealthFailure(new Error("local bug")), false);
});

test("circuit opens after threshold and recovers after cooldown", () => {
  let clock = 1_000_000;
  const health = createProviderHealth({
    failureThreshold: 2,
    openMs: 10_000,
    now: () => clock
  });

  health.recordFailure("alpha", providerError("PROVIDER_NETWORK_ERROR"), 1000);
  assert.equal(health.circuitState("alpha"), "closed");
  assert.equal(health.canRoute("alpha"), true);

  health.recordFailure("alpha", providerError("UPSTREAM_TIMEOUT"), 2000);
  assert.equal(health.circuitState("alpha"), "open");
  assert.equal(health.canRoute("alpha"), false);
  assert.equal(health.snapshot("alpha").retryAfterMs, 10_000);

  clock += 10_001;
  assert.equal(health.circuitState("alpha"), "recovering");
  assert.equal(health.canRoute("alpha"), true);

  health.recordSuccess("alpha", 500);
  assert.equal(health.circuitState("alpha"), "closed");
  assert.equal(health.snapshot("alpha").consecutiveFailures, 0);
});

test("success resets consecutive provider failures", () => {
  const health = createProviderHealth({ failureThreshold: 3 });
  health.recordFailure("alpha", providerError("PROVIDER_NETWORK_ERROR"), 100);
  health.recordFailure("alpha", providerError("PROVIDER_NETWORK_ERROR"), 100);
  assert.equal(health.snapshot("alpha").consecutiveFailures, 2);

  health.recordSuccess("alpha", 100);
  assert.equal(health.snapshot("alpha").consecutiveFailures, 0);
  assert.equal(health.snapshot("alpha").successes, 1);
});

test("health score degrades with failures and slow latency", () => {
  const health = createProviderHealth({
    failureThreshold: 5,
    latencyTargetMs: 1000
  });

  assert.equal(health.score("alpha"), 100);
  health.recordFailure("alpha", providerError("PROVIDER_NETWORK_ERROR"), 4000);
  assert.ok(health.score("alpha") < 100);
  assert.ok(health.snapshot("alpha").latencyEwmaMs >= 4000);
});

test("local failures do not poison provider health", () => {
  const health = createProviderHealth({ failureThreshold: 1 });
  health.recordFailure("alpha", new Error("filesystem failure"), 50);
  const snapshot = health.snapshot("alpha");
  assert.equal(snapshot.failures, 0);
  assert.equal(snapshot.circuit, "closed");
});
