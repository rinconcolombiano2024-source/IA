"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createExperimentPlan } = require("../src/infinity/experiment-plan");
const valid = {
  question: "Does algorithm X improve latency?",
  hypothesis: "Algorithm X may be faster",
  sourceUrl: "https://example.org/study",
  sourceTitle: "Background study",
  steps: [{ action: "Compare fixed inputs", expectedObservation: "Latency measurement" }],
  successCriterion: "Median latency is lower on identical inputs"
};
test("creates a non-executable immutable plan requiring approval", () => {
  const plan = createExperimentPlan(valid, { now: "2026-10-17T00:00:00Z" });
  assert.equal(plan.executionStatus, "not_executed");
  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.externalExecutionAllowed, false);
  assert.equal(plan.research.verified, false);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.steps[0]));
});
test("rejects empty, malformed and oversized experiment steps", () => {
  assert.throws(() => createExperimentPlan({ ...valid, steps: [] }), /1 to 12/);
  assert.throws(() => createExperimentPlan({ ...valid, steps: [{ action: "", expectedObservation: "x" }] }), /Invalid step/);
  assert.throws(() => createExperimentPlan({ ...valid, steps: Array(13).fill(valid.steps[0]) }), /1 to 12/);
});
test("rejects plans without success criteria and unsafe source URLs", () => {
  assert.throws(() => createExperimentPlan({ ...valid, successCriterion: "" }), /successCriterion/);
  assert.throws(() => createExperimentPlan({ ...valid, sourceUrl: "file:///etc/passwd" }), /HTTPS/);
});
