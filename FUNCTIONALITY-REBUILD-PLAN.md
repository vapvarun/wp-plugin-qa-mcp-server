# wp-plugin-qa — Functionality-First Rebuild

> Directive (2026-06-15): this MCP must answer **"does the feature actually work"**.
> Code quality, Plugin Check, lint scaffolding, advisory UX grep and market analysis
> are NOISE here — they are run separately. Do not wire or modify Basecamp.

## Why the old shape underdelivered

31 tools, most of them **advisory**: they analysed code/markup and returned findings an
agent had to judge. That is why it "never gave expected results" — advisory ≠ verdict, and
half the surface (code quality, plugin-dev rules, security grep, visual regression, market
analysis) was hygiene, not functionality. A passing scan told you nothing about whether a
toggle enforces or a page renders.

## The principle (what makes a verdict trustworthy)

**The check is code, not prose. It executes against a live, seeded site and asserts an
outcome. The LLM may propose new checks; it is never itself the check.** The MCP's job is to
*run the deterministic engine and transport the verdict*, not to reason about whether
something looks right.

## Tier 0 — the core (executes; deterministic verdict)

- **`wppqa_certify`** *(new)* — shells out to the plugin's own `wp <ns> cert` engine
  (Certify; see the plugin's docs/plans/functional-certification-system.md). Flips every
  gated setting OFF/ON and proves the REST behaviour changes (dead-toggle detection), boots
  every route (no fatals), reports HOLEs. This is the headline answer to "does it work".

## Tier 1 — functionality checks (kept)

Cross-layer + live-site, the checks that catch the bug classes QA actually files:

- `wppqa_scan_plugin` — manifest discovery (the oracle every other check reads)
- `wppqa_check_wiring_completeness` — every feature reachable frontend + backend + API
- `wppqa_check_rest_js_contract` — REST shape ↔ JS consumer agreement
- `wppqa_check_template_contract` / `wppqa_check_templates` — template variable contracts
- `wppqa_check_api` / `wppqa_check_database` / `wppqa_check_browser` — live-site behaviour
- `wppqa_probe_roles` — access-control matrix (who-can-do-what actually enforced)
- `wppqa_cross_reference_data` / `wppqa_check_enum_consistency` — data-contract integrity
- `wppqa_check_qa_coverage` — coverage meta
- `wppqa_check_a11y` — accessibility (a real functional defect for users)
- `wppqa_evaluate_product` — admin/frontend product behaviour
- `wppqa_audit_*` (5) — journey-by-journey customer-experience audit
- `wppqa_bootstrap_plan`, `wppqa_learn_from_basecamp` — kept as-is (Basecamp untouched)

## Hidden — non-functional noise (run separately)

Filtered out of the surface in `src/tools.ts` (`EXCLUDED_NON_FUNCTIONAL`), code retained so
it is one-line reversible: `setup_quality`, `run_code_checks`, `check_code_quality`,
`security_quality_audit`, `check_plugin_dev_rules`, `check_editor_layout_bias`, `check_ux`,
`check_ux_guidelines`, `check_visual_regression`, `analyze_market`.

## Deeper rebuild (phased — next, not done here)

1. **Promote advisory Tier-1 checks toward executable.** Where a check still returns prose,
   give it a live-site assertion path (like `wppqa_certify`) so it emits pass/fail, not a
   finding. `wiring_completeness` and `rest_js_contract` are the first candidates.
2. **One report shape.** Every tool returns the same `{ ok, summary, rows[] }` ledger so the
   surface is uniform and an agent never has to parse free text.
3. **Delete the hidden checkers + their files** once confirmed unused for a release cycle
   (right now they are only filtered, to stay reversible).
4. **Extract the cert delegate** so any plugin with a `cert` command is covered by one MCP.

## Activation note

MCP servers load at session start — the new `wppqa_certify` tool and the trimmed surface go
live after the Claude session reconnects to this server (restart the session / MCP).
