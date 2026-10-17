"use strict";

const EVIDENCE_STATES = Object.freeze(["hypothesis", "simulation", "experimental", "peer_reviewed", "clinically_validated"]);

function createResearchRecord(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Research record must be an object");
  const required = ["question", "hypothesis", "sourceUrl", "sourceTitle"];
  for (const key of required) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 4000) {
      throw new TypeError(`Invalid ${key}`);
    }
  }
  let url;
  try { url = new URL(input.sourceUrl); } catch { throw new TypeError("Invalid sourceUrl"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("Source must be an HTTPS URL without credentials");
  const state = input.evidenceState || "hypothesis";
  if (!EVIDENCE_STATES.includes(state)) throw new TypeError("Invalid evidenceState");
  if (state !== "hypothesis" && (!Array.isArray(input.evidence) || input.evidence.length === 0)) {
    throw new TypeError("Evidence is required for non-hypothesis states");
  }
  if (input.evidence !== undefined && (!Array.isArray(input.evidence) || input.evidence.some(x => typeof x !== "string" || !x.trim() || x.length > 2000) || input.evidence.length > 20)) {
    throw new TypeError("Invalid evidence");
  }
  const now = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new TypeError("Invalid timestamp");
  return Object.freeze({
    question: input.question.trim(), hypothesis: input.hypothesis.trim(),
    source: Object.freeze({ title: input.sourceTitle.trim(), url: url.toString() }),
    evidenceState: state,
    evidence: Object.freeze([...(input.evidence || [])]),
    createdAt: new Date(now).toISOString(),
    verified: false,
    notice: "Evidence status is user-supplied and has not been independently verified. Simulations do not establish real-world or clinical efficacy."
  });
}

module.exports = { EVIDENCE_STATES, createResearchRecord };
