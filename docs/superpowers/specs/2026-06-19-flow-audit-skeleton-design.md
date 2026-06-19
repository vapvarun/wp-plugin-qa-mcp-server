# Flow Audit Skeleton — Design

- **Date:** 2026-06-19
- **Status:** Approved (design) — pending spec review
- **Repo:** `wp-plugin-qa-mcp-server` (MCP-native)
- **First foundation / fixture:** BuddyNext free + Pro pair (`~/dev/repos/buddynext`, `~/dev/repos/buddynext-pro`)

## Purpose

After ~900 ad-hoc fixes across 3 days on the BuddyNext pair, a senior-level
**functionality flow audit** is required before go-live: not function-level
linting, but a **semantic data-flow** audit across the REST and template layers
— where data is actually produced and consumed — that also catches duplicate
and wrong function usage and dead code.

This is built as a **reusable audit skeleton** inside the wp-plugin-qa MCP
server, following the existing `*-checker.ts` / `CheckerResult` pattern.
BuddyNext is the first foundation: every checker is validated against the BN
pair, and the patterns proven there become the MCP defaults. Lifting the
suite into the live MCP tool list later is just tool registration — no rework.

## Scope

- **Code scope:** BuddyNext **free + Pro pair** as one contract surface
  (~1,150 PHP files, ~180 templates, ~1,976 functions, 168 REST routes,
  1,055 fired hooks). Dup / dead-code / data-flow only make sense across the
  pair (Pro consumes free hooks; Pro bridges feed free templates).
- **Deliverable this pass:** full skeleton + the 4 deterministic checkers
  **live**, the 3 existing checkers folded in, runner + report + baseline, and
  the suite **run on the BN pair to produce the real go-live report**. The
  judgment-heavy `logic-flow` ships as a descriptor-emitter + oracle schema
  (stubs to populate). No multi-agent Workflow required for this pass.

## Defect classes (confirmed)

1. Duplicate / near-duplicate functions
2. Broken data flow (produced ↔ consumed) across REST + template layers
3. Wrong / inconsistent function usage (service-layer bypass, raw SQL in templates)
4. Orphaned / dead code (defined, never consumed in the pair)
5. Logic flow (end-to-end behavior, entry → outcome)
6. Template usage (which templates load, by whom, with what data)

## Architecture

### The FlowGraph backbone — `src/flow-graph.ts`

One pass over the pair builds a typed graph. This IS the semantic data-flow
model and the manifest enrichment (REST info + template info + function index
unified), persisted to **`audit/flow.json`**. Every checker reads the graph
instead of re-parsing source; future MCP tools read the same file.

- **Nodes:** `RestRoute` · `Handler/method` · `ServiceMethod` · `Function` ·
  `Template` · `Hook` · `JsConsumer` · `Option/meta key` · `Table`
- **Edges:** `calls` (fn→fn) · `returns` (route→response-shape keys) · `reads`
  (consumer→keys) · `loads` (loader→template + arg keys) · `fires` / `consumes`
  (hook) · `gatedBy` (route→option)

The graph reuses existing scanner data already in the manifest
(`rest.endpoints` with `requestArgs`/`gatedBy`, `hooks_fired`, `wiring`,
`tables`) and the loader↔template contract logic already implemented in
`template-contract-checker.ts`.

### Checkers — each a `*-checker.ts` returning `CheckerResult`

| Module | Defect class | Status |
|---|---|---|
| `dup-function-checker` | Duplicate / near-dup functions: signature + normalized-body hash → clusters, recommend canonical | new |
| `orphan-checker` | Dead code: graph nodes with no inbound consumer (fns, handlers, unfired/unconsumed hooks, never-loaded templates) | new |
| `rest-flow-checker` | Broken data flow: route returns a key no consumer reads (dead output) / consumer reads a key no route returns (broken read), across JS **and** SSR template consumers | extends `rest-js-contract` |
| `canonical-usage-checker` | Wrong function: raw `$wpdb`/SQL in templates, table access bypassing a service method, local helper where a canonical exists (rules data-driven) | new |
| `template-usage-checker` | Template usage map: every template → loader(s) + supplied args + feeding route/service; flags wrong-args / never-loaded / duplicate-purpose | extends `template-contract` |
| `template-contract-checker` | Loader↔template variable contract | exists (fixed 2026-06-19, green on BN) |
| `rest-js-contract-checker` | REST↔JS envelope contract | exists (green on BN) |
| `logic-flow` (descriptor emitter) | End-to-end behavior: graph defines each flow (entry → outcome); static emits flow descriptors + ties to `cert-oracles.json`; runtime/agent confirms correctness | new (skeleton + oracle hooks) |

### Runner & gate — `src/flow-audit.ts` + `wppqa_flow_audit` MCP tool

Build graph once → run all checkers → write **`audit/flow-audit-report.md`**
grouped by defect class + severity. `error`-level findings fail the gate. A
committed baseline (**`audit/.flow-audit-baseline.json`**) holds triaged
intentional exceptions — same model as `.contract-audit-baseline.json`.

### Incremental graph cache + sub-agent semantic layer (token-efficient)

The expensive parse runs **once**; subsequent runs touch only what changed.

- **Per-file fingerprint:** `flow.json` stores `sha1(path + content)` per file.
  Re-run: hash all PHP/JS, diff against stored fingerprints → only
  changed/added/deleted files are re-parsed; their nodes/edges are swapped in
  place; unchanged files' graph data is reused verbatim. Later runs are
  O(changed files) — the "only update based on what's updated" requirement.
- **Per-checker result cache:** each checker records the node/edge types it
  consumed + a result hash. On an incremental run a checker re-runs only if the
  changed nodes intersect its inputs; otherwise it returns its cached
  `CheckerResult`.
- **Sub-agent semantic layer:** deterministic TS checkers do the cheap,
  exhaustive parse into the graph — **zero LLM tokens**. Judgment work
  (near-dup intent confirmation, wrong-function calls, logic-flow correctness)
  is delegated to sub-agents that read **graph slices** (the candidate cluster +
  just the relevant bodies), never the whole repo. Agents see hundreds of lines,
  not 1,150 files; they run in parallel, one per candidate/flow; the graph hands
  them a concrete shortlist so they never re-scan. (Workflow opt-in only — not
  used in this pass.)

## Build sequence (skeleton-first)

1. `flow-graph.ts` + `flow.json` schema + per-file fingerprint cache — the
   foundation everything else needs.
2. The 4 new deterministic checkers (`dup-function`, `orphan`, `rest-flow`,
   `canonical-usage`) + fold in the 3 existing checkers.
3. Runner + report + baseline (`flow-audit.ts`, `wppqa_flow_audit`).
4. `logic-flow` descriptor emitter + oracle schema hooks.
5. Run on the BN pair → triage → fix real defects → populate baseline + oracles
   → ship `flow-audit-report.md`.

## Components & boundaries

- `flow-graph.ts` — builds/loads/incrementally-updates the graph; owns
  `flow.json` read/write + fingerprinting. Pure data; no findings.
- each `*-checker.ts` — pure function `(graph, pluginPaths) → CheckerResult`;
  no source re-parsing, no cross-checker state.
- `flow-audit.ts` — orchestration only: build graph, run checkers, aggregate,
  render report, apply baseline. No detection logic of its own.
- baseline + oracles — committed data, not code.

Each checker can be understood, tested, and changed in isolation against a
fixture `flow.json`.

## Testing

- Unit-test each checker against small hand-authored `flow.json` fixtures
  (one positive + one negative case per defect class).
- Validate the full suite against the BN pair: deterministic checkers must run
  clean or every finding must be triaged (real fix vs baselined exception).
- Incremental correctness: a full build and an incremental build after a
  touched file must produce identical graphs + findings.

## Out of scope (this pass)

- Registering the tools in the live MCP `server.ts` tool list (later step).
- Multi-agent Workflow execution of `logic-flow` (opt-in, separate pass).
- Generalizing rules beyond what BN needs (BN-proven patterns first).
