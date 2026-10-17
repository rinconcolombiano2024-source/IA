"use strict";

/** INFINITY SCIENTIST: assemble a reproducible, non-executing research dossier. */
const { createExperimentPlan } = require("./experiment-plan");

function createResearchDossier(input, options = {}) {
  const plan = createExperimentPlan(input, options);
  const warnings = [
    "Sources and evidence are supplied by the caller, not independently verified.",
    "A proposed experiment is not an executed experiment.",
    "A simulation alone cannot demonstrate real-world or clinical efficacy."
  ];
  return Object.freeze({
    schemaVersion: 1,
    kind: "infinity.research.dossier",
    question: plan.research.question,
    hypothesis: plan.research.hypothesis,
    sources: Object.freeze([plan.research.source]),
    evidenceState: plan.research.evidenceState,
    evidence: plan.research.evidence,
    experiment: Object.freeze({
      steps: plan.steps,
      successCriterion: plan.successCriterion,
      executionStatus: plan.executionStatus,
      approvalRequired: plan.approvalRequired,
      externalExecutionAllowed: plan.externalExecutionAllowed
    }),
    generatedAt: plan.research.createdAt,
    verificationStatus: "unverified",
    warnings: Object.freeze(warnings)
  });
}

module.exports = { createResearchDossier };
