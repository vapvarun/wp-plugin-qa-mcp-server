# Using the functional-cert harness on another plugin

The harness answers one question for any WordPress plugin: **does the feature actually work** — toggles
enforce, routes don't fatal, layers are wired — confirmed against a live site. It is **plugin-agnostic**:
the only per-plugin inputs are a generated manifest and a small oracles file. No plugin code is required.

This is the adoption checklist. It takes ~10 minutes per plugin. Example paths below assume a plugin
named `acme` at `/Users/you/dev/repos/acme`, active on a local WP at `/Users/you/Local Sites/acme/app/public`.

---

## 0. Prerequisites

- The plugin is **installed and active** on a local WordPress you can reach with WP-CLI
  (`wp --path="<wp_root>" plugin list` shows it active).
- This MCP server is built: `cd ~/.mcp-servers/wp-plugin-qa-mcp-server && npm run build`.
- `wp` (WP-CLI) and `node` on PATH.

---

## 1. Generate the manifest (deterministic)

The manifest is the harness's model of the plugin — generated from code, never hand-written.

```bash
cd ~/.mcp-servers/wp-plugin-qa-mcp-server
node bin/write-manifest.mjs /Users/you/dev/repos/acme
# → wrote NNNKB → /Users/you/dev/repos/acme/audit/manifest.json
```

This writes `<plugin>/audit/manifest.json` with: REST routes (+ request args + the option that gates
each), options-wiring (written / read / enforced), feature groups, template vars vs loader args,
hooks→listeners, and frontend-JS REST consumption. It is deterministic (no timestamps) — commit it,
and regenerate after structural changes (or wire it into your onboarding refresh).

**Footprint:** the manifest is the one growing file; it stays well under the plugin's own size. Nothing
else is written into `audit/` except the oracles file below.

---

## 2. Run the audit (boot + candidates work immediately, zero config)

Even with no oracles, `boot` (no route fatals) and the static `candidates` run right away:

```bash
node --input-type=module -e '
import { runEngine, formatEngine } from "./build/cert-runner.js";
console.log(formatEngine(runEngine({
  wpRoot: "/Users/you/Local Sites/acme/app/public",
  pluginPath: "/Users/you/dev/repos/acme"
})));'
```

Or, from an agent/MCP client, call the **`wppqa_audit`** tool with `{ wp_root, plugin_path }`
(add `oracles_path` once you have step 3).

Read the output as:
- **FAILURES** — confirmed: a feature does not behave. Fix these.
- **CANDIDATES** — static smells (option written-but-never-enforced, feature missing a UX layer).
  Unconfirmed — confirm by hand, or promote to an oracle (step 3). Never counted as failures.

---

## 3. Write oracles (the `contract` check — dead-toggle confirmation)

An oracle proves a setting actually gates behaviour: flip it OFF then ON, assert the disabled error
code appears when off and is absent when on. Create `<plugin>/audit/cert-oracles.json`:

```json
{
  "contract": [
    {
      "id": "acme_allow_widgets",
      "kind": "option",
      "route": "/acme/v1/widgets",
      "method": "POST",
      "params": {},
      "off_code": "widgets_disabled"
    },
    {
      "id": "comments",
      "kind": "feature",
      "route": "/acme/v1/comments",
      "method": "POST",
      "params": { "object_id": 1, "content": "probe" },
      "off_code": "comments_disabled"
    }
  ]
}
```

Field guide:
- `id` — the option name (`kind:"option"`) or feature-flag slug (`kind:"feature"`).
- `kind` — `"option"` flips `get_option(id)` between `'0'`/`'1'`; `"feature"` flips the slug inside the
  plugin's feature-flags option array (default key `buddynext_features` — change in the engine if your
  registry uses another option).
- `route` / `method` / `params` — a request that hits the gate. The gate must fire **before** any data
  lookup, so the probe is data-independent.
- `off_code` — the `WP_Error`/response `code` returned when the feature is OFF.

**How to find oracle candidates fast:**
```bash
cd /Users/you/dev/repos/acme
grep -rn "_disabled'" includes/                 # → off_code + the controller it lives in
grep -rn "is_enabled( '" includes/               # → feature-flag gates
```
Each `*_disabled` code in a REST controller is one oracle. Re-run step 2 with `oracles_path` set and
confirm every oracle shows `off→<code>(403) on→-(2xx)`.

---

## 4. Wire the real-time Stop-hook gate (optional but recommended)

Makes cert the agent's enforced definition-of-done: it blocks finishing on any failure introduced in a
session. See `hooks/README.md`. Two steps:

1. `<plugin>/.cert.json` (gitignored — machine-specific):
   ```json
   { "wp_path": "/Users/you/Local Sites/acme/app/public", "plugin_path": "/Users/you/dev/repos/acme" }
   ```
2. Register the `Stop` hook once in `~/.claude/settings.json` (already done if you set it up for the
   first plugin — it resolves the active repo per-session, so one registration covers all plugins).

---

## 5. Self-improvement loop

Every time a real functional bug is found (QA, production, the audit), add one oracle row in step 3.
The bug becomes a permanent regression check — it can never silently return. The oracles file grows ~1
line per bug; coverage only ever increases.

---

## What carries over vs. what's per-plugin

| Piece | Per-plugin? |
|---|---|
| The MCP engine, scanner, Stop hook, `wppqa_audit` tool | **No** — shared, one codebase |
| `audit/manifest.json` | Generated from the plugin's code (step 1) |
| `audit/cert-oracles.json` | Hand-authored, ~1 line per gated setting (step 3) |
| `.cert.json` | Machine-specific local config (step 4) |

## Engine assumptions to check on a non-BuddyNext plugin

- **Feature-flags option name.** `kind:"feature"` oracles flip the `buddynext_features` array. If the
  plugin's registry stores flags under a different option, update that name in
  `engine/cert-engine.php` (the `'buddynext_features'` literal) — or use `kind:"option"` oracles, which
  are registry-independent.
- **Auth.** The engine authenticates as user ID 1 (admin) before dispatch. Ensure user 1 is an admin on
  the target site.
- **Candidate heuristics** (dead-toggle name shapes, feature-group name clustering) are tuned for
  Wbcom naming; they only ever produce *candidates*, never failures, so a mismatch is noise you can
  ignore, not a wrong verdict.
