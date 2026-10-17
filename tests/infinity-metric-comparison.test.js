"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { compareExperimentMetrics } = require("../src/infinity/metric-comparison");
test("lower latency improves by 25 percent", () => {
  const result = compareExperimentMetrics({ metric: "latency_ms", baseline: 100, candidate: 75, direction: "lower", minimumImprovementPercent: 20 });
  assert.equal(result.improvementPercent, 25);
  assert.equal(result.thresholdMet, true);
  assert.equal(result.verificationStatus, "unverified");
});
test("higher throughput can fail threshold", () => {
  const result = compareExperimentMetrics({ metric: "throughput", baseline: 100, candidate: 105, direction: "higher", minimumImprovementPercent: 10 });
  assert.equal(result.improvementPercent, 5);
  assert.equal(result.thresholdMet, false);
});
test("rejects invalid inputs and division by zero", () => {
  assert.throws(() => compareExperimentMetrics({ metric: "latency", baseline: 0, candidate: 1, direction: "lower" }), /Metrics/);
  assert.throws(() => compareExperimentMetrics({ metric: "latency", baseline: 1, candidate: Infinity, direction: "lower" }), /Metrics/);
  assert.throws(() => compareExperimentMetrics({ metric: "latency", baseline: 1, candidate: 2, direction: "unknown" }), /Direction/);
  assert.throws(() => compareExperimentMetrics({ metric: "latency", baseline: 1, candidate: 2, direction: "lower", minimumImprovementPercent: -1 }), /threshold/);
});
