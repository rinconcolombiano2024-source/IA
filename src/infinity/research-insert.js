"use strict";

const { researchOwnerFilter } = require("./research-principal");

/**
 * Pure insert payload builder for the proposed server-only research table.
 * Caller MUST obtain principal from trusted server authentication.
 * Does not write to a database or elevate scientific evidence.
 */
function buildResearchInsert(principal, researchRecord, options = {}) {
  const owner = researchOwnerFilter(principal);
  if (!researchRecord || typeof researchRecord !== "object" || Array.isArray(researchRecord) ||
      researchRecord.verified !== false || typeof researchRecord.question !== "string" ||
      !researchRecord.source || typeof researchRecord.source.url !== "string" ||
      !["hypothesis", "simulation", "experimental", "peer_reviewed", "clinically_validated"].includes(researchRecord.evidenceState)) {
    throw new TypeError("Invalid unverified research record");
  }
  const record = JSON.parse(JSON.stringify(researchRecord));
  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > 65536) throw new RangeError("Research record exceeds storage limit");
  const projectId = options.projectId;
  if (projectId !== undefined && (typeof projectId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(projectId))) {
    throw new TypeError("Invalid project identifier");
  }
  return Object.freeze({
    tenant_id: owner.tenant_id,
    owner_user_id: owner.owner_user_id,
    ...(projectId === undefined ? {} : { project_id: projectId }),
    record: Object.freeze(record),
    evidence_verified: false
  });
}

module.exports = { buildResearchInsert };
