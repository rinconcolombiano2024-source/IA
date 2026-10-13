"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRuntimeGuard,
  parsePositiveInteger
} = require("../src/security/runtime-guard");

test("parsePositiveInteger applies fallback and bounds", () => {
  assert.equal(parsePositiveInteger("x", 7, 1, 10), 7);
  assert.equal(parsePositiveInteger("0", 7, 1, 10), 1);
  assert.equal(parsePositiveInteger("99", 7, 1, 10), 10);
});

test("rate limit blocks after maxRuns and resets after the window", () => {
  let now = 1_000;
  const guard = createRuntimeGuard({
    windowMs: 1_000,
    maxRuns: 2,
    maxConcurrentRuns: 2,
    maxPromptChars: 100,
    now: () => now
  });

  assert.equal(guard.consumeRun().allowed, true);
  assert.equal(guard.consumeRun().allowed, true);

  const blocked = guard.consumeRun();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 1);

  now = 2_001;
  const reset = guard.consumeRun();
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 1);
});

test("concurrency guard rejects excess work and releases slots", () => {
  const guard = createRuntimeGuard({
    maxConcurrentRuns: 2
  });

  assert.equal(guard.tryAcquireRun(), true);
  assert.equal(guard.tryAcquireRun(), true);
  assert.equal(guard.tryAcquireRun(), false);
  assert.equal(guard.releaseRun(), 1);
  assert.equal(guard.tryAcquireRun(), true);
  assert.equal(guard.releaseRun(), 1);
  assert.equal(guard.releaseRun(), 0);
});

test("prompt validation rejects text above the configured maximum", () => {
  const guard = createRuntimeGuard({
    maxPromptChars: 100
  });

  assert.equal(guard.validatePrompt("a".repeat(100)).ok, true);

  const rejected = guard.validatePrompt("a".repeat(101));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "PROMPT_TOO_LARGE");
  assert.equal(rejected.maxPromptChars, 100);
});

test("snapshot exposes only operational guard state", () => {
  const guard = createRuntimeGuard({
    windowMs: 5_000,
    maxRuns: 3,
    maxConcurrentRuns: 2,
    maxPromptChars: 500
  });

  guard.consumeRun();
  guard.tryAcquireRun();

  const snapshot = guard.snapshot();
  assert.equal(snapshot.windowMs, 5_000);
  assert.equal(snapshot.maxRuns, 3);
  assert.equal(snapshot.maxConcurrentRuns, 2);
  assert.equal(snapshot.maxPromptChars, 500);
  assert.equal(snapshot.activeRuns, 1);
  assert.equal(snapshot.remainingRuns, 2);
});
