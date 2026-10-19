"use strict";

const { researchOwnerFilter } = require("./research-principal");

/**
 * Build a strictly owner-scoped PostgREST query for the proposed research table.
 * Pure function: does not contact Supabase, authenticate users or change data.
 * The caller MUST pass a server-verified principal, never a client-provided one.
 */
function buildResearchListQuery(principal, options = {}) {
  const owner = researchOwnerFilter(principal);
  const limit = options.limit === undefined ? 20 : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Research query limit must be between 1 and 100");
  }
  const params = new URLSearchParams();
  params.set("tenant_id", `eq.${owner.tenant_id}`);
  params.set("owner_user_id", `eq.${owner.owner_user_id}`);
  params.set("select", "id,record,evidence_verified,review_at,created_at");
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));
  return params.toString();
}

module.exports = { buildResearchListQuery };
