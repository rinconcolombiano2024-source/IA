"use strict";

/**
 * Compare numeric experiment observations against a predefined baseline.
 * Does not execute experiments or verify source authenticity.
 */
function compareExperimentMetrics(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid metric comparison");
  const { baseline, candidate, metric, direction, minimumImprovementPercent = 0 } = input;
  if (typeof metric !== "string" || !/^[a-zA-Z][a-zA-Z0-9_. -]{0,79}$/.test(metric)) throw new TypeError("Invalid metric");
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate) || baseline <= 0 || candidate < 0) throw new TypeError("Metrics must be finite, baseline positive and candidate nonnegative");
  if (!["lower", "higher"].includes(direction)) throw new TypeError("Direction must be lower or higher");
  if (!Number.isFinite(minimumImprovementPercent) || minimumImprovementPercent < 0 || minimumImprovementPercent > 100) throw new TypeError("Invalid improvement threshold");
  const improvementPercent = direction === "lower"
    ? (baseline - candidate) / baseline * 100
    : (candidate - baseline) / baseline * 100;
  return Object.freeze({
    metric, baseline, candidate, direction, minimumImprovementPercent,
    improvementPercent, thresholdMet: improvementPercent >= minimumImprovementPercent,
    verificationStatus: "unverified",
    executionStatus: "observations_supplied_by_caller",
    note: "Numerical comparison only. Measurements and experimental validity have not been independently verified."
  });
}
module.exports = { compareExperimentMetrics };
