"use strict";

/**
 * Fail-closed authorization gate for experimental agent tool requests.
 * The caller MUST provide a server-authenticated principal and a trusted
 * policy. This module never executes tools or grants privileges.
 */
const { requireResearchPrincipal } = require("./research-principal");

function authorizeResearchTool(principal, request, policy) {
  const owner = requireResearchPrincipal(principal);
  if (!request || typeof request !== "object" || Array.isArray(request) ||
      typeof request.tool !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(request.tool)) {
    throw new TypeError("Invalid tool request");
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      !Array.isArray(policy.allowedTools) || !policy.allowedTools.every(x => typeof x === "string")) {
    throw new TypeError("Trusted tool policy required");
  }
  const allowed = policy.allowedTools.includes(request.tool);
  const sensitive = policy.sensitiveTools instanceof Array && policy.sensitiveTools.includes(request.tool);
  const approved = request.approval === true && policy.humanApprovalVerified === true;
  return Object.freeze({
    tenantId: owner.tenantId,
    userId: owner.userId,
    tool: request.tool,
    permitted: allowed && (!sensitive || approved),
    reason: !allowed ? "tool_not_allowed" : sensitive && !approved ? "human_approval_required" : "permitted"
  });
}

module.exports = { authorizeResearchTool };
