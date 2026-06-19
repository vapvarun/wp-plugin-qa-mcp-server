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

## Scan scope — distribution-ready files only

The graph is built ONLY over files that ship in the release, to avoid wasting
tokens/time on tests, docs, and tooling. The scope is **derived from the
release allowlist** (single source of truth), not a hand-maintained exclude
list — so "what we audit" always equals "what ships."

- **Source of truth:** parse `bin/build-release.sh` (`RUNTIME[]` + `OPTIONAL[]`
  arrays) — or a `.distignore` if one exists. For BN free, RUNTIME =
  `buddynext.php includes templates assets blocks libs theme.json` + `vendor`,
  OPTIONAL = `languages uninstall.php readme.txt`. Pro: read its own
  `bin/build-release.sh`. Fallback default exclude set if no build script:
  `tests/`, `test-results/`, `docs/`, `plan*/`, `audit*/`, `bin/`,
  `mu-plugins/`, `node_modules/`, `.github/`, all `*.md`.
- **Our-code vs third-party:** `libs/` and `vendor/` ship but are third-party.
  They are **call-edge targets only** — the graph resolves calls *into* them so
  our symbols don't look orphaned, but they are NEVER scanned for dup / orphan /
  wrong-function findings (not ours to fix).
- **JS scope:** only enqueued/shipped `assets/` JS (the same files the plugin
  registers), not build sources or `node_modules`.
- The exclusion is applied in `flow-graph.ts` at file-enumeration time, so every
  downstream checker inherits it for free.

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

**Parse strategy — PHP-AST sidecar (hybrid).** The PHP side of the graph is
built by a small PHP script using **`nikic/php-parser`** (already in BN's
`vendor/`) that emits symbols, classes/methods, call-sites,
callback-registrations, and service-container bindings as JSON;
`flow-graph.ts` (TS) consumes that JSON. This accurately resolves BN's
dominant indirect dispatch — `[$this,'method']` callbacks, the
`buddynext_service('id')->method()` service locator, and `register_rest_route`
callbacks (480+ edges) — which a regex heuristic would mis-resolve, producing
noise on exactly the dup/orphan/wrong-function classes that matter most. `php`
is already required for the cert harness, so no new dependency. TS continues to
own JS parsing, orchestration, the report, and the existing narrow-scope
checkers (`template-contract`, `rest-js-contract` stay TS-regex — they work
well on their bounded problem).

The graph also reuses existing scanner data already in the manifest
(`rest.endpoints` with `requestArgs`/`gatedBy`, `hooks_fired`, `wiring`,
`tables`) and the loader↔template contract logic already in
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

## Gap analysis & hardening (self-audit 2026-06-19)

Probing the BN pair exposed assumptions the naive design would have gotten
wrong. These are now requirements, not nice-to-haves.

### 1. Consumption registry — orphan-checker correctness (HIGH)

BN's dominant calling convention is indirect: **257** `[$this,'method']`
callbacks, **229** `'callback' =>` REST registrations, **224**
`buddynext_service('id')->method()` service-locator dispatches, 7
`call_user_func`. A name-based `calls` edge alone would mark most methods
"dead." The graph MUST treat **registration as consumption** across every
mechanism: `add_action`/`add_filter` (string AND `[$obj,'m']`/`[Class::class,'m']`
AND closures), `register_rest_route` `callback`/`permission_callback`,
`register_activation/deactivation_hook`, `add_shortcode`, block
`render_callback`, `wp_schedule_event`/cron, `register_setting`
sanitize/auth callbacks, and WP-CLI commands. Any symbol referenced as a
callback is consumed.

### 2. Service-locator resolution (HIGH)

`buddynext_service('feed')->render()` is the primary dispatch. The graph
builder must resolve service IDs → bound class → methods (parse the service
container registration map once) so method-call edges resolve. Unresolved
service IDs are reported as a graph-quality warning, never silently dropped.

### 3. Near-duplicate method + legitimate-override exclusion (HIGH)

"Duplicate" = exact normalized-body hash (whitespace/comments stripped, but
NOT identifier renaming — renamed-var clones are a separate, lower-confidence
tier). "Near-duplicate" = token-shingle Jaccard similarity over a threshold
(default 0.85), reported as lower severity for human confirmation. Explicitly
EXCLUDE legitimate Free/Pro extension: a Pro method that **overrides** a free
method (same class hierarchy), or a callback that replaces another via filter,
is not a dup. Cross-pair dup = two *independent* implementations of the same
intent, not an override.

### 4. Two distinct data-flow planes (MEDIUM-HIGH)

Do not invent a REST→template edge. There are two planes:
(a) **REST route → JS consumer** (envelope keys) — owned by `rest-flow-checker`
/ `rest-js-contract`; (b) **controller/service → template** (loader arg keys)
— owned by `template-usage` / `template-contract`. A template consumes PHP
service data, never a route's JSON. `rest-flow-checker` scopes to plane (a);
SSR coverage lives in plane (b). Dynamic response shapes (service-hydrated
arrays) that can't be resolved to literal keys are reported as
"shape-unresolved" (graph-quality info), not as a false contract break.

### 5. Stable finding IDs for baselining (MEDIUM)

`generateTestId()` is a per-run sequential counter — unusable for a committed
baseline (IDs shift every run). Flow-audit findings use **content-derived
stable IDs**, e.g. `orphan:fn:BuddyNext\\Feed\\FeedController::render`,
`dup:<sorted-member-hash>`, matching the semantic-ID style of
`.contract-audit-baseline.json`.

### 6. Reuse existing flow inventory (MEDIUM)

logic-flow does NOT invent a flow list. It consumes `audit/journeys.json`,
`audit/CODE_FLOWS.md`, and `audit/cert-oracles.json` as the entry→outcome
inventory, emits descriptors that map graph paths onto those journeys, and
flags journeys with no resolvable graph path (coverage gap) and graph entry
points absent from the journey inventory (undocumented flow).

### 7. Incremental invalidation honesty (LOW)

The per-file fingerprint cache saves the **parse**, which is the expensive
part. Global graph-walk checkers (dup, orphan) are cross-file by nature and
recompute from the whole graph whenever ANY node changes — but that walk is
cheap (it reads the graph, not source). Per-checker caching meaningfully helps
only the file-local checkers; the spec does not overclaim per-checker savings
for global ones.

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

## Precision over recall (non-negotiable)

Every checker emits only high-confidence, actionable findings with a concrete fix. Suppress likely-false-positives via name-reference floors, comment-stripping, trivial-body thresholds, and response-var scoping even at the cost of recall. A finding that a human or AI must triage to decide whether it is real is a tool failure, not a finding. NEVER emit candidate piles or "N issues, triage them." The rule: if the checker cannot assert with high confidence that the finding is real, it must stay silent.

Refinements applied so far: strip PHP comments before matching; require `$wpdb` (not any `->get_*`) for raw-SQL; exclude empty-body hashes from dup clustering; capture `$this->`/`self::`/`Class::` method calls in the graph; scope JS reads to the response binding variable (not any obj.prop near the URL); skip dup clusters where every member body is < 80 chars (trivial stubs like `return true;`); suppress never-loaded template warnings when the template name appears in any quoted string literal (dynamic load).

Corollary — pinpoint-or-one-line: a checker whose ground truth requires runtime/coverage or external-consumer knowledge (dead-code/orphan, unresolved response shapes) MUST emit a single advisory summary, never per-item findings. Static dead-code detection is unreliable in both directions (dynamic dispatch → false live-looks-dead; reverted registrations → dead-looks-live); confirm dead code with runtime coverage, not statically. Per-item findings are reserved for checkers with deterministic ground truth: dup (identical AST), template-contract, rest-js-contract, canonical-usage, rest-flow broken-read, template-usage never-loaded, logic-flow no-path.
