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

## cert oracle kinds (the jury's vocabulary)

cert grows from 2 kinds to 5. Each kind = a deterministic runtime assertion:

- `contract` *(exists)* — flip the setting OFF/ON; assert the REST behaviour flips.
- `boot` *(exists)* — dispatch the route; assert no fatal / 500.
- `render` *(new)* — render the template with its loader's declared `$args`; **fail on an
  undefined-variable notice or missing expected output**.
- `shape` *(new)* — dispatch the route; assert the response contains the keys the paired JS
  consumer reads (sourced from the rest-js contract).
- `wiring` *(new)* — assert the feature actually responds in all three layers (front render
  present, admin/service reachable, REST route live).

Oracle row stays compact: `{ id, kind, route, expect }`. The whole oracle file grows ~1 line per
confirmed bug.

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

## Phasing (lean vertical slices, each verifiable)

Wiring first — an unwired harness is waste — using the cert that already works (`contract`+`boot`).

- **P1 (the wiring — proves real-time self-correction):** the **Stop-hook gate**. It runs the
  EXISTING cert (`contract`+`boot`) scoped to the agent's touched surfaces, blocks on
  agent-introduced failures, injects corrections. Plus point the detectives at `manifest.json`.
  This immediately catches the dead-toggle / route-fatal regressions the agent makes, in-session.
  Verified: plant a dead toggle, confirm the Stop hook blocks the turn with the correction; fix,
  confirm it lets the turn finish.
- **P2 (grow what gets caught):** add the **`render`** (template contract), **`shape`** (rest-js),
  and **`wiring`** (3-layer) cert kinds; re-point those detectives to the manifest + typed-candidate
  output so the Stop hook now also blocks on those classes.
- **P3 (deep audits + cleanup):** the **`wppqa_audit`** orchestrator (whole-plugin detective → cert →
  learn) + the confirmed-correction return shape; retire the superseded advisory tools once their
  detectives feed cert.

## Testing

- Detective: given a manifest fixture with a known missing layer, emits exactly that candidate.
- cert kinds: each new kind goes red on a seeded break and green when fixed (the existing
  "break-it-watch-it-red" discipline).
- Loop: a planted dead toggle is found by the detective, confirmed by cert, and a re-run after the
  fix is green with the oracle persisted.
- Storage: after a full audit run, `audit/` contains only `manifest.json` + `cert-oracles.json`
  (no new files); `cert-ledger.json` is gitignored.
