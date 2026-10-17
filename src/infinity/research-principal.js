"use strict";

/**
 * Authorization boundary for future INFINITY MEMORY adapters.
 * The trusted server MUST supply an authenticated principal; never use a
 * client-provided tenant or user ID as authentication.
 */
function requireResearchPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw new TypeError("Authenticated principal required");
  }
  const { tenantId, userId, authenticated } = principal;
  if (authenticated !== true) throw new TypeError("Authenticated principal required");
  if (typeof tenantId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId)) {
    throw new TypeError("Invalid tenant identifier");
  }
  if (typeof userId !== "string" || !/^[a-zA-Z0-9_.:@-]{1,200}$/.test(userId)) {
    throw new TypeError("Invalid user identifier");
  }
  return Object.freeze({ tenantId, userId });
}

/**
 * Scoped filter builder for the server-only persistence adapter.
 * Does not perform network requests or authenticate a token.
 */
function researchOwnerFilter(principal) {
  const { tenantId, userId } = requireResearchPrincipal(principal);
  return Object.freeze({ tenant_id: tenantId, owner_user_id: userId });
}

module.exports = { requireResearchPrincipal, researchOwnerFilter };
