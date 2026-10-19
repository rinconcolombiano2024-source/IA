"use strict";

const { requireResearchPrincipal } = require("./research-principal");

/**
 * Pure server-side ownership check for future persistence integration.
 * IMPORTANT: caller must establish the principal using verified authentication.
 * A client-supplied authenticated=true is NOT proof of authentication.
 */
function assertResearchOwnership(principal, row) {
  const identity = requireResearchPrincipal(principal);
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      row.tenant_id !== identity.tenantId || row.owner_user_id !== identity.userId) {
    const error = new Error("Research record not found");
    error.code = "RESEARCH_NOT_FOUND";
    throw error;
  }
  return true;
}

module.exports = { assertResearchOwnership };
