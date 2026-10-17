"use strict";

/**
 * INFINITY: deterministic research experiment specification.
 * This module NEVER executes code, fetches URLs, or claims scientific validation.
 */
const { createResearchRecord } = require("./research-record");
const MAX_STEPS = 12;

function createExperimentPlan(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Experiment input must be an object");
  }
  const research = createResearchRecord(input, options);
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS) {
    throw new TypeError("Experiment requires 1 to 12 steps");
  }
  const steps = input.steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new TypeError("Invalid experiment step");
    }
    for (const key of ["action", "expectedObservation"]) {
      if (typeof step[key] !== "string" || !step[key].trim() || step[key].length > 1000) {
        throw new TypeError(`Invalid step ${index + 1} ${key}`);
      }
    }
    return Object.freeze({
      sequence: index + 1,
      action: step.action.trim(),
      expectedObservation: step.expectedObservation.trim()
    });
  });
  if (typeof input.successCriterion !== "string" ||
      !input.successCriterion.trim() || input.successCriterion.length > 2000) {
    throw new TypeError("A bounded successCriterion is required");
  }
  return Object.freeze({
    research,
    steps: Object.freeze(steps),
    successCriterion: input.successCriterion.trim(),
    executionStatus: "not_executed",
    approvalRequired: true,
    externalExecutionAllowed: false,
    note: "This plan is not evidence that an experiment has been run or validated."
  });
}

module.exports = { createExperimentPlan };
