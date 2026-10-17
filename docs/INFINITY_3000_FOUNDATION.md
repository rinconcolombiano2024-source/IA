# IA MAX 3000 — INFINITY foundation (experimental)

Status: design proposal only. This document does not enable agents, execute external code, or alter production.

## Baseline observed on 2026-10-17
- Node.js >=18; `npm test` uses `node --test`.
- `src/core/model-router.js` selects candidates deterministically by capability, health, quality, error rate, latency and cost.
- `src/providers/registry.js` exposes a modular provider registry.
- README states public UI does not imply public paid model access, and production requires authentication; generated files in Vercel can be ephemeral.

These observations are based on repository source inspection, not executed integration tests.

## Phase 1: safe research pipeline (proposed)
1. Receive a research question with explicit scope, budget, privacy policy, and approval boundaries.
2. Collect source references and record timestamps, provenance, license, and evidence grade.
3. Produce falsifiable hypotheses and a simulation plan; do not equate simulation with physical validation.
4. Request human approval before any tool execution or paid API call.
5. Execute only reviewed experiments in isolated infrastructure, without production secrets, with CPU/time/network quotas.
6. Store signed or hashed experiment manifests, inputs, outputs, metrics, and failures.
7. Have an independent verifier compare results against predefined acceptance criteria.
8. Propose changes through a reviewed pull request; never auto-merge or auto-deploy.

## Candidate modules
- `INFINITY CORE`: add orchestration alongside, not in place of, the existing router.
- `INFINITY MEMORY`: tenant-isolated facts with source, confidence, timestamps, retention and deletion.
- `INFINITY SCIENTIST`: evidence retrieval, hypothesis drafting, experiment specification.
- `INFINITY GUARDIAN`: authorization, budgets, audit log, cancellation, prompt-injection defenses.

## First implementation acceptance criteria
- Existing tests pass unchanged on an approved isolated runner.
- No production secrets, network access, or untrusted code in test fixtures.
- At least one synthetic research task produces a reproducible, source-linked report.
- Hypotheses are clearly labeled as unverified; medical findings are not presented as cures.
- No changes to `main`, deployment configuration, authentication, or database schema.
- Human review is required before subsequent implementation.

## Open decisions
- Select approved persistence backend and data retention policy.
- Decide execution sandbox and threat model.
- Define multilingual evaluation dataset (Spanish, Polish, English).
- Set budgets, quality metrics and operational SLOs.

## Rollback
This branch adds documentation only. Revert its commit or delete the branch; no runtime behavior is changed.
