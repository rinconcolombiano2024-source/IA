"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizeResearchTool } = require("../src/infinity/research-tool-policy");
const principal = { authenticated: true, tenantId: "team_a", userId: "user_a" };

test("denies unlisted tools and preserves authenticated owner scope", () => {
  const decision = authorizeResearchTool(principal, { tool: "delete_records" }, { allowedTools: ["read_research"] });
  assert.equal(decision.permitted, false);
  assert.equal(decision.reason, "tool_not_allowed");
  assert.equal(decision.tenantId, "team_a");
  assert.equal(decision.userId, "user_a");
});

test("permits a non-sensitive allowlisted tool", () => {
  const decision = authorizeResearchTool(principal, { tool: "read_research" }, { allowedTools: ["read_research"] });
  assert.equal(decision.permitted, true);
});

test("requires trusted human approval for sensitive tools", () => {
  const policy = { allowedTools: ["publish_report"], sensitiveTools: ["publish_report"] };
  assert.equal(authorizeResearchTool(principal, { tool: "publish_report", approval: true }, policy).permitted, false);
  assert.equal(authorizeResearchTool(principal, { tool: "publish_report" }, { ...policy, humanApprovalVerified: true }).permitted, false);
  assert.equal(authorizeResearchTool(principal, { tool: "publish_report", approval: true }, { ...policy, humanApprovalVerified: true }).permitted, true);
});

test("rejects untrusted principal and malformed policy", () => {
  assert.throws(() => authorizeResearchTool({ ...principal, authenticated: false }, { tool: "read_research" }, { allowedTools: ["read_research"] }));
  assert.throws(() => authorizeResearchTool(principal, { tool: "../escape" }, { allowedTools: [] }));
  assert.throws(() => authorizeResearchTool(principal, { tool: "read_research" }, {}));
});
