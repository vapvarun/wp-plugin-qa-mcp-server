# Flow Audit — How to run on any plugin (generic instructions)

**Scope:** reusable instructions only — applicable to ANY plugin. No per-effort task backlog here. Each plugin's concrete findings + fix tasks live in that plugin's own `audit/FLOW-AUDIT-TODO.md` (e.g. `buddynext/audit/FLOW-AUDIT-TODO.md`).

## What this is
A semantic data-flow audit suite (FlowGraph + PHP-AST sidecar + 8 checkers): `src/flow/`, `php-ast/extract-graph.php`, `src/*-checker.ts`, runner `src/flow-audit.ts` + CLI `src/flow-audit-cli.ts`. Design/plan: `docs/superpowers/specs|plans/2026-06-19-flow-audit-skeleton*`.

## Run it on a plugin pair
```
npm run build
node build/flow-audit-cli.js <freeRoot> [<proRoot>]
```
Writes `<freeRoot>/audit/flow.json` (graph cache, gitignore it) and `<freeRoot>/audit/flow-audit-report.md`. Exits 1 if any unbaselined `error`-level finding remains.

## Triage method (every first run mixes real bugs with noise)
1. Triage **every `error`** (the gate set). For each: real defect → fix in the plugin; verified-intentional/false-positive → add `{id, reason}` to `<plugin>/audit/.flow-audit-baseline.json` (stable content-derived ids; never bulk-baseline unreviewed).
2. **Warning/info** findings (orphan, dead-output, logic-flow coverage) are advisory candidates — walk them, don't gate on them.
3. **Spot-verify** ~3 findings per category against source. If a *systematic* false-positive class appears, refine the checker (below) and re-run — don't baseline noise.

## Refine a checker when a run reveals a systematic false positive
This is the suite's self-improvement loop (how it got trustworthy on BuddyNext). Examples of refinements already applied: strip PHP comments before matching; require `$wpdb` (not any `->get_*`) for raw-SQL; exclude empty-body hashes from dup clustering; capture `$this->`/`self::`/`Class::` method calls in the graph; exclude DOM/JS-API props from JS-read matching. Add a unit test (RED→GREEN) for each refinement; the change benefits every plugin.

## Generic release-gate recipe (each plugin wires this in its own repo)
Add before packaging in the plugin's `bin/build-release.sh` / pre-tag checklist:
```
node <mcp>/build/flow-audit-cli.js "$PLUGIN_DIR" "$PRO_DIR" || { echo "Flow audit failed - fix or baseline before release"; exit 1; }
```

## Onboard a new plugin to the audit
Run the CLI on the pair → triage to a baseline → create `<plugin>/audit/FLOW-AUDIT-TODO.md` capturing that plugin's real findings + fixes. Generalize any new checker refinement back into this suite so the next plugin benefits.
