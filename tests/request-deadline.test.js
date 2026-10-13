"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRequestDeadline,
  clampInteger
} = require("../src/core/request-deadline");

test("clampInteger applies fallback and bounds", () => {
  assert.equal(clampInteger("x", 7, 1, 10), 7);
  assert.equal(clampInteger("0", 7, 1, 10), 1);
  assert.equal(clampInteger("99", 7, 1, 10), 10);
});

test("deadline tracks remaining and usable time", () => {
  let now = 1_000;
  const deadline = createRequestDeadline({
    deadlineMs: 10_000,
    responseReserveMs: 2_000,
    now: () => now
  });

  assert.equal(deadline.remainingMs(), 10_000);
  assert.equal(deadline.usableMs(), 8_000);

  now = 8_500;
  assert.equal(deadline.remainingMs(), 2_500);
  assert.equal(deadline.usableMs(), 500);

  now = 12_000;
  assert.equal(deadline.remainingMs(), 0);
  assert.equal(deadline.usableMs(), 0);
});

test("attempt timeout never exceeds provider or request budget", () => {
  let now = 1_000;
  const deadline = createRequestDeadline({
    deadlineMs: 10_000,
    responseReserveMs: 2_000,
    now: () => now
  });

  assert.equal(deadline.attemptTimeoutMs(3_000), 3_000);
  assert.equal(deadline.attemptTimeoutMs(12_000), 8_000);

  now = 8_500;
  assert.equal(deadline.attemptTimeoutMs(3_000), 500);
});

test("canWait prevents retries that would consume response reserve", () => {
  let now = 1_000;
  const deadline = createRequestDeadline({
    deadlineMs: 10_000,
    responseReserveMs: 2_000,
    now: () => now
  });

  assert.equal(deadline.canWait(1_000, 1_000), true);

  now = 8_500;
  assert.equal(deadline.canWait(100, 500), false);
});
