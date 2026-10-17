# INFINITY — Evidence contract (experimental)

This document defines a non-executable, backward-compatible contract for future research modules. It does not enable autonomous actions or claim scientific results.

## Experiment record (proposed schema v0)

Required: `experiment_id`, `project_id`, `owner_id`, `hypothesis`, `status`, `created_at`, `method_version`, `input_digest`, `metrics`, `limitations`.

Optional: `sources` (URL, retrieved_at, license, evidence level), `seed`, `environment_digest`, `artifact_digests`, `reviewed_by`, `reviewed_at`.

Allowed status progression: proposed → approved → running → evaluated → reviewed. Failure/cancellation are terminal, with reasons. No experimental finding is promoted to verified knowledge without independently reviewable evidence.

## Safety invariants

- Deny tool execution by default; require scoped user authorization and human approval for sensitive actions.
- Separate tenant data by authenticated identity, not by client-supplied IDs alone.
- Set explicit time, token, compute, storage and network budgets before experiments.
- Treat retrieved documents and model outputs as untrusted data, never instructions.
- Persist immutable audit references and support deletion/retention policies for personal data.
- Do not run proposed model changes in production automatically.

## Acceptance tests to implement before runtime integration

1. Reject records missing required fields or with invalid status transitions.
2. Prevent cross-user reads/writes even when a client supplies another user's project ID.
3. Reject unapproved execution and verify cancellation releases resources.
4. Verify identical inputs, seeds and environment digests yield reproducible results when the experiment is deterministic.
5. Preserve source provenance and distinguish hypothesis, simulation and externally validated result.
6. Demonstrate no changes to existing chat, provider routing, authentication or restaurant endpoints.

## Integration boundary

Reuse existing provider registry, model router, runtime guard and state-store abstractions. Before selecting persistent storage, audit its actual tenant isolation, encryption, deletion and durability guarantees. This proposal intentionally adds no dependencies, routes, migrations or runtime behavior.
