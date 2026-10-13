"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseRetryAfterMs,
  computeBackoffMs,
  getOpenAiRetryDecision,
  getOpenAiNetworkRetryDelay
} = require("../src/providers/openai/retry-policy");

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("5", 0), 5_000);
  assert.equal(
    parseRetryAfterMs("Thu, 01 Jan 1970 00:00:10 GMT", 4_000),
    6_000
  );
  assert.equal(parseRetryAfterMs("invalid", 0), null);
});

test("409 conflicts are not retried blindly", () => {
  const decision = getOpenAiRetryDecision({ status: 409, attempt: 0, random: () => 0 });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "conflict_requires_state_check");
});

test("temporary 429 follows Retry-After", () => {
  const decision = getOpenAiRetryDecision({
    status: 429,
    errorType: "rate_limit_error",
    errorCode: "slow_down",
    retryAfter: "3",
    attempt: 0,
    random: () => 0
  });

  assert.equal(decision.retry, true);
  assert.equal(decision.delayMs, 3_000);
  assert.equal(decision.reason, "temporary_rate_limit_retry_after");
});

test("quota and spend 429 responses are not retried", () => {
  for (const code of [
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded"
  ]) {
    const decision = getOpenAiRetryDecision({
      status: 429,
      errorCode: code,
      attempt: 0,
      random: () => 0
    });
    assert.equal(decision.retry, false, code);
    assert.equal(decision.reason, "quota_or_billing", code);
  }

  const byType = getOpenAiRetryDecision({
    status: 429,
    errorType: "insufficient_quota",
    attempt: 0,
    random: () => 0
  });
  assert.equal(byType.retry, false);
});

test("server failures use exponential backoff with bounded jitter", () => {
  const first = getOpenAiRetryDecision({
    status: 503,
    attempt: 0,
    random: () => 0
  });
  const second = getOpenAiRetryDecision({
    status: 503,
    attempt: 1,
    random: () => 0
  });

  assert.equal(first.retry, true);
  assert.equal(first.delayMs, 700);
  assert.equal(second.delayMs, 1_400);
});

test("non transient client errors are not retried", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(
      getOpenAiRetryDecision({ status, attempt: 0, random: () => 0 }).retry,
      false
    );
  }
});

test("network retry delay uses the same bounded backoff policy", () => {
  assert.equal(getOpenAiNetworkRetryDelay(0, { random: () => 0 }), 700);
  assert.equal(getOpenAiNetworkRetryDelay(1, { random: () => 0 }), 1_400);
  assert.equal(computeBackoffMs(10, { random: () => 1 }), 15_000);
});
