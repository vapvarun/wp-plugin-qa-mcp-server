# Flow Audit — MCP Handoff & Remaining Work (plugin-agnostic)

**Date:** 2026-06-19
**Scope:** ONLY tasks that apply to the audit tool itself / any plugin. Per-plugin findings live in each plugin's own `audit/FLOW-AUDIT-TODO.md` (e.g. BuddyNext's `audit/` dir).
**Status:** Suite built, merged to `master` (local only, NOT pushed). 64 tests passing.

## Context

A reusable, MCP-native semantic data-flow audit suite in `wp-plugin-qa-mcp-server`:
- **Graph:** `src/flow/` (graph model, scope, fingerprint cache, php-graph ingest, rest-shapes, build) + PHP-AST sidecar `php-ast/extract-graph.php`.
- **8 checkers:** `src/{dup-function,orphan,rest-flow,canonical-usage,template-usage,logic-flow,template-contract,rest-js-contract}-checker.ts`.
- **Runner/CLI:** `src/flow-audit.ts`, `src/flow-audit-cli.ts` — `node build/flow-audit-cli.js <freeRoot> [proRoot]`.
- **Design + plan:** `docs/superpowers/specs/2026-06-19-flow-audit-skeleton-design.md`, `docs/superpowers/plans/2026-06-19-flow-audit-skeleton.md`.
- **Tests:** `npm run build && node --test build/__tests__/*.test.js` (64 passing).

Validated by running on the BuddyNext free+pro pair (per-plugin results handed off in that plugin's repo, not here).

---

## Wave 0 — Publish (Infra) · ~5 min

- **W0.1 Push the MCP repo.** `master` is ahead with the merged suite (merge commits `8d05cad`, `fbb5926`). `git push origin master`. Merged branches `flow-audit-skeleton`, `orphan-call-graph` can be pushed or deleted.

---

## Wave 1 — Productionize as a live MCP gate (Tooling) · applies to all plugins

- **W1.1 Register `wppqa_flow_audit` in `server.ts`.** Expose the runner as an MCP tool (`{wp_root/freeRoot, proRoot?}`) so it's one call alongside the other `wppqa_*` checks. (Intentionally left out of the build pass.)
- **W1.2 Generic release-gate recipe.** Document/provide the snippet any plugin adds to its `bin/build-release.sh` / pre-tag checklist: run the audit, fail the tag on unbaselined errors (mirrors the contract-audit gate). The recipe is plugin-agnostic; each plugin wires it in its own repo.
- **W1.3 Per-file incremental graph patching.** `buildOrUpdate` currently reuses the whole graph only when nothing changed, else full rebuild. Implement true per-file patching (re-parse only changed files, splice their nodes/edges) for large repos. An equivalence test already exists (`incremental.test.ts`).

---

## Wave 2 — Checker precision hardening (Tooling) · applies to all plugins

Each shrinks false positives / closes a known gap in the suite. Generic — benefits every plugin the audit runs on.

- **W2.1 Resolve calls into `libs/`/`vendor/` (spec gap).** `buildGraph` ignores `resolveScanScope().thirdParty`; calls into bundled libs drop their edge. Ingest third-party symbols as call-target-only nodes (never scanned for findings) so our-code flow resolves. See design §"Our-code vs third-party". (`src/flow/build.ts`, `php-graph.ts`.)
- **W2.2 Improve orphan dynamic-dispatch resolution.** Capture `call_user_func`/`call_user_func_array` with array-callable literals; resolve `$obj->m()` where `$obj` is a typed property/param (light type inference from `@var`/constructor promotion). Each resolved pattern cuts orphan false-positives across all plugins. (`php-ast/extract-graph.php`, `php-graph.ts`.)
- **W2.3 Cap/summarize warning-level findings in the report.** `renderReport` lists every finding inline (reports get large on big plugins). Cap per-category warning detail (first N + "and X more") so reports stay reviewable. (`src/flow/report.ts`.)
- **W2.4 Close the logged Minor gaps (from build reviews).** Direct tests for `writeGraph`/`readGraph`; `rest-flow` shapeUnresolved branch test; `canonical-usage` `passed` accounting (files-minus-issues → files-with-issues) + `tplFiles` Set lookup; `extractShapeKeys` nested-array handling. None block; all small.
- **W2.5 Surface the orphan blind spot generically.** Registration callbacks that are closures or cross-file-unresolved aren't marked consumed (false-orphan risk). Already code-commented in `php-graph.ts`; have the audit emit it as a standing report note so every plugin's triagers know.
- **W2.6 Improve `extractJsReads` precision (rest-flow false-positive source).** Today it matches ANY `obj.prop` within a character window of the route URL and relies on a DOM/JS-API exclusion list — so `rest-flow:broken-read` findings are candidates, not certainties (the dominant noise in that checker). Scope reads to the actual response variable: track the `await fetch(...).then(r => r.json())` / `const data = await res.json()` binding and only count property access on that identifier (and its destructure). Cuts broken-read noise to near-real across all plugins. (`src/flow/rest-shapes.ts`; covered by the existing exclusion-list test plus new binding-scoped cases.)

---

## Wave 3 — Roll out to other plugins (Rollout) · depends on Wave 1

- **W3.1 Run the suite on 2–3 other Wbcom plugin pairs.** Each first run mixes real bugs with noise — triage, baseline, capture any new false-positive class as a checker refinement. Confirms the suite generalizes. (Per-plugin findings go to each plugin's own `audit/FLOW-AUDIT-TODO.md`.)
- **W3.2 Fold proven patterns into `wp-plugin-onboard`.** The flow.json enrichment (REST shapes, template loaders, function index) and the audit become part of the standard onboarding manifest + release QA across the 100+ plugins.

---

## Dependency map

```
W0 (push) ──► W1 (MCP gate) ──► W3 (rollout)
W2 (precision) ─ independent; do early to reduce noise for every plugin ─
```
