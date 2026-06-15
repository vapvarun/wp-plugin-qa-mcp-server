# wp-plugin-qa — Functionality Self-Correction Redesign

> **Spec.** Brainstormed 2026-06-15. Next step: writing-plans.

## Purpose (who this is for)

This MCP is a **self-correction harness for the AI developer**. The agent (Claude) is the one
writing the code, and the agent is the one introducing the functional defects — dead toggles,
half-wired features, template/REST contract drift, missing layers. On 2026-06-15 those exact
defects reached QA as **50+ cards in one day** while every static gate stayed green.

The MCP's job is to catch the agent's *functional* mistakes and hand back **actionable
corrections** before the work reaches QA or the user. It is run by the agent as its own
definition-of-done check after editing — not a report a human reads later. Every card QA files
is a correction this harness should have produced first.

**Non-goals:** code quality, WPCS, Plugin Check, lint, security grep, market analysis — those
are noise here and run separately. This harness answers exactly one question: *does the feature
the agent just touched actually work, in every layer it claims?*

## Scope of this spec (read this before the architecture)

This document has two layers, kept deliberately separate so nothing reads as more-built than it is:

- **The target architecture** (sections "Architecture", "Expectations", "MCP surface") — the
  detective → cert → learn system we are aiming at. Aspirational; do not assume any of it is built.
- **THE BUILD** (the section titled exactly that, near the end) — the *one concrete, bounded thing
  that ships from this spec*: a Stop hook wiring the **already-working** cert (`contract`+`boot`) into
  the agent's session. Everything in the target architecture beyond that is in "Later", and most of it
  is **blocked on a manifest enrichment that does not exist yet** — stated plainly, not phased in.

If you only read one section, read **THE BUILD**.

## The core failure being fixed (in priority order)

1. **Noise / false positives** — today's checkers pattern-match code and *advise*; they emit
   candidates that aren't actually broken. Fix: **confirm every candidate at runtime with cert**
   before reporting it.
2. **Misses real bugs** — they don't model the full surface. Fix: derive expectations from the
   **canonical manifest**, one invariant per layer, so every real entity is covered.
3. **Drift** — the MCP self-scans, so its picture of the plugin goes stale. Fix: read the
   plugin's **`audit/manifest.json`** as the single source of truth.

## Architecture: detective finds, jury confirms, learn remembers

```
audit/manifest.json  (what the agent built — source of truth, regenerated from code)
        │
        ▼
DETECTIVE  (MCP, TypeScript, static + manifest)
  derive each entity's invariant → scan code/templates/JS for violations
  → emit TYPED CANDIDATES (not prose)
        │
        ▼
JURY  (cert, PHP, runs in the live seeded site)
  each candidate → a cert oracle of its KIND → RUN it
  behaves wrong → REAL ISSUE   |   behaves fine → DROPPED as noise
        │
        ▼
LEARN  (cert-learn)
  a confirmed issue's oracle is appended to audit/cert-oracles.json
  → permanent regression check; the agent cannot silently reintroduce it
        │
        ▼
RETURN to the agent: { file:line, violated invariant, cert verdict } — a correction, not a report
```

- **Detective = MCP** (reads the whole tree + manifest; good at cross-layer static reasoning).
- **Jury = cert** (lives in the plugin; has the DB, hooks, internal REST dispatch — the only place
  a behavioural verdict is trustworthy).
- **The agent fixes, then re-runs** — the loop closes on the agent, in-session.

## Integration: wired into real-time development (the part that makes this not-waste)

A harness the agent *can* call but isn't *forced* to call rots exactly like the 13 skills and the
orphaned Playwright suite did. So the verdict is wired in as an **unskippable Stop-hook gate** on the
agent's own session — plus a manual MCP entry point for deep dives.

**Primary wiring — Claude Code Stop hook (enforcement):**
- A `Stop` hook in `~/.claude/settings.json` runs a small script after the agent finishes a turn.
- The script is **cheap when nothing changed**: `git diff --name-only` (vs session baseline); if no
  plugin code was touched, exit 0 immediately (conversational turns pay nothing).
- When plugin code *was* touched, it maps the changed files → affected manifest surfaces and runs
  `wp --path=$BN_WP_PATH <ns> cert --porcelain` (scoped to those surfaces).
- It compares against a **session baseline ledger** so it blocks only on failures the agent
  *introduced this session*, never on pre-existing debt (no crying wolf).
- On a confirmed new failure → the hook returns `{"decision":"block","reason": <the corrections>}`:
  the agent **cannot finish**, and the `file:line + violated invariant + cert verdict` is injected
  back into its context. The agent fixes, re-runs, and only stops clean.
- Clean → exit 0, the agent finishes.

This makes cert the agent's **definition of done, enforced** — the dead toggle the agent just wrote
is caught in the same session, before it is ever handed off. It is the structural answer to
"50 cards reached QA while smoke stayed green".

**Secondary wiring — MCP `wppqa_audit` (interactive):** when the agent or user wants a deep,
whole-plugin functional audit (not just the touched surfaces), they call the MCP tool, which runs the
full detective → cert → learn loop and returns the confirmed-correction list. Same engine, broader
scope, human/agent-initiated.

**Setup is one-time per machine:** the Stop hook entry + a `BN_WP_PATH` (or per-repo `.cert.json`)
pointing at the live site. Documented in the plugin's CLAUDE.md so the workflow is discoverable.

## Expectations = manifest-derived invariants, one per layer

No hand-authored expectations catalog. Each manifest entity carries an invariant derived from its
kind; the gap between "exists" (manifest) and "should do" (invariant) is a candidate:

| Manifest entity | Invariant (what the agent must not break) | cert KIND |
|---|---|---|
| option / feature flag | readable **and** enforced (UI + REST) | `contract` |
| REST route | does not fatal; honors its declared `permission` | `boot` |
| REST route ↔ JS consumer | response contains the keys the JS actually reads | `shape` |
| template | every `$var` it uses is supplied by its loader's `$args` | `render` |
| feature | reachable in **all 3 layers** — frontend, backend, API | `wiring` |

Layers come from the manifest's existing sections (`rest`, `admin_pages`, `services`,
`templates`, `frontend_assets`, `hooks`). The product-level `category_expectations` checker is
kept but **reconciled against the manifest** (whole-feature presence), not run free-hand.

## cert oracle kinds — what is ACTUALLY buildable now vs blocked

Hard truth after auditing `audit/manifest.json`: its sections are `plugin, rest, ajax, admin_pages,
tables, services, hooks_fired, capabilities, cron, blocks, shortcodes, frontend_assets`. It has **no
`templates` section, and REST endpoints carry no response schema** (only route/methods/handler/
permission/purpose). So:

**Buildable now — already built + verified:**
- `contract` — flip a setting OFF/ON via internal REST dispatch; assert the disabled error code
  appears when off, absent when on. *5 oracles passing on buddynext.*
- `boot` — dispatch every GET route from the manifest; assert no fatal / 500. *60 routes, 0 fail.*

**NOT buildable yet — each blocked on a concrete manifest enrichment, named so we don't pretend:**
- `render` (template contract) — **blocked on:** a `templates` section recording each template's
  slug + the `$args` keys its loader passes. Does not exist. Building `render` means first teaching
  the manifest generator to emit it.
- `shape` (REST↔JS) — **blocked on:** REST endpoints recording their response key set (or a detective
  statically extracting the keys each JS consumer reads). Neither exists today.
- `wiring` (3-layer reachability) — **blocked on:** a feature→{template, admin/service, route}
  mapping. The manifest has the raw layers but no grouping into "features".

These three are **explicitly OUT OF SCOPE for this build** — a separate, later effort whose real first
task is enriching the manifest, not a phase to slip in as if designed. The oracle row format
`{ id, kind, route, expect }` already accommodates them once their data exists.

## Storage policy — `audit/` must never outgrow the plugin

`audit/` contains exactly two durable, bounded files:
- `manifest.json` — regenerated from code; bounded by plugin size; never accretes.
- `cert-oracles.json` — the system's entire memory; one compact row per confirmed issue.

Everything else is **ephemeral, never written into the plugin**:
- `cert-ledger.json` → gitignored (run output).
- Detective candidates, confirmed-issue corrections, journey matrices → returned to the caller
  in-memory / `/tmp`. **The old `basecamp-learner` per-card cache trees are not reintroduced.**

Net audit footprint = manifest (derived from code) + a few-KB oracle file. It cannot outgrow the
plugin.

## MCP surface — two roles, not 22 tools

- **Detectives** (re-pointed to read `manifest.json`, output typed candidates instead of prose):
  `wiring_completeness`, `template_contract`, `rest_js_contract`, `cross_reference_data`,
  `enum_consistency`, `category_expectations`.
- **Jury / report:** `wppqa_certify` (runs cert incl. the new kinds) + a new **`wppqa_audit`**
  that runs the whole detective → cert → learn loop and returns the confirmed-correction list.
- **Live evidence (kept):** `check_api`, `check_database`, `check_browser`, `probe_roles`.
- **Already cut (stay cut):** the 10 hygiene/code-quality/Plugin-Check/market tools.
- **Untouched:** `learn_from_basecamp` (per directive — do not touch Basecamp).

## Data flow (one feature, end to end)

1. Agent edits a feature (say, adds a `reactions` toggle).
2. Agent runs `wppqa_audit` → detective reads `manifest.json`, sees the `reactions` flag, derives
   "must be enforced", scans and finds the REST route has no `is_enabled` guard → **candidate**.
3. cert runs a `contract` oracle for `reactions` → OFF still returns 200 → **confirmed real**.
4. MCP returns: `ReactionController::toggle (includes/Reactions/...) — reactions flag not enforced;
   cert: off→200 expected 403`.
5. Agent fixes it; re-runs `wppqa_audit` → cert green; cert-learn persists the `reactions` oracle.
6. The dead toggle can never silently return.

## Error handling

- **No manifest** → detective falls back to `scanner.ts` and emits a warning (degraded, not broken).
- **cert unavailable** (plugin has no `cert` command) → candidates are returned as *unconfirmed*
  (clearly labelled), never as confirmed issues. Fail safe toward "unconfirmed", never false-confirm.
- **cert can't reach a live site** → the audit reports which kinds it could not run (coverage-honest),
  rather than passing silently.

## THE BUILD (this spec) — exact scope, no hedging

**What I am building:** a Claude Code **Stop hook** that runs the existing, working `wp <ns> cert`
(`contract`+`boot`) on the code I touched this session and **blocks me from finishing if I introduced
a failure** — feeding the cert verdict back as a correction. Nothing more. It uses cert as-is; it adds
no new cert kinds, no detective rewrite, no manifest changes.

### Exact artifacts
1. `~/.mcp-servers/wp-plugin-qa-mcp-server/hooks/cert-stop.sh` — the hook script. Behaviour:
   - Resolve the target: read `BN_CERT` config — a JSON `{ wp_path, cli_ns }` from
     `$CLAUDE_PROJECT_DIR/.cert.json` (per-repo), else env `BN_WP_PATH`/`BN_CERT_NS`. If neither
     resolves → **exit 0** (hook is a no-op for non-cert repos).
   - `git -C <repo> diff --name-only` since the session baseline. If no file under the plugin
     changed → **exit 0** (conversational turns cost nothing).
   - Run `wp --path=<wp_path> <cli_ns> cert --porcelain`; parse the JSON ledger.
   - Compare `fail` rows against the **baseline ledger** captured at session start
     (`/tmp/cert-baseline-<session>.json`). Block only on `fail` rows **not** in the baseline
     (failures I introduced), never on pre-existing ones.
   - New fails → print JSON `{"decision":"block","reason": <the fail rows as file/entity + verdict>}`
     to stdout and exit 0 (Claude Code reads the block decision). No new fails → exit 0 silently.
2. A baseline capture: a `SessionStart` hook (or the first `cert-stop` run) writes
   `/tmp/cert-baseline-<session>.json` = the ledger at session start.
3. `.cert.json` example committed to the buddynext repo: `{ "wp_path": "…/app/public", "cli_ns": "buddynext" }`.
4. A `~/.claude/settings.json` snippet (documented, applied with consent) registering the `Stop`
   (and `SessionStart`) hook.
5. A short "How the cert Stop-hook works" section in buddynext's CLAUDE.md.

### What this build is NOT
- Not the `render`/`shape`/`wiring` cert kinds (blocked on manifest enrichment — separate effort).
- Not the detective→cert wiring or `wppqa_audit` orchestrator (those depend on the new kinds).
- Not any manifest-generator change.

### Verification (definition of done for THIS build)
- Plant a dead toggle in buddynext → the Stop hook **blocks** the turn, printing the
  `contract/<flag>` fail as the correction. Fix it → the hook lets the turn finish.
- Break a GET route to fatal → blocked on the `boot/<route>` fail. Fix → passes.
- A pre-existing failure present at session start does **not** block (baseline diff works).
- A conversational turn with no plugin edit → hook exits in <50ms, no cert run.

## Later (explicitly deferred, prerequisite-gated — NOT this build)

1. **Manifest enrichment** (the real prerequisite): add a `templates` section (slug + loader `$args`)
   and REST response key sets to the manifest generator. Until this lands, render/shape/wiring cannot
   be built.
2. After (1): the `render`/`shape`/`wiring` cert kinds + re-pointing the detectives
   (`template_contract`, `rest_js_contract`, `wiring_completeness`) to emit typed candidates.
3. After (2): the `wppqa_audit` MCP orchestrator (whole-plugin detective → cert → learn) and retiring
   the superseded advisory tools.
