# Functionality Self-Correction Harness — Design Spec

> Brainstormed + approved 2026-06-15. Clean rewrite (supersedes the earlier patchwork). Next: writing-plans.

## Purpose — who this is for

This is a **self-correction harness for the AI developer**. The agent (Claude) writes the code, and
the agent introduces the functional defects — dead toggles, half-wired features, missing UX, template
and REST↔JS contract drift, broken notifications. On 2026-06-15 those reached QA as **50+ cards in one
day** while every static gate stayed green.

The harness catches the agent's *functional* mistakes and hands back **actionable corrections**
(`file:line` + the violated invariant + the runtime verdict) **before** the work reaches QA — run as
the agent's own definition-of-done. It must work for **every Wbcom plugin and theme (100+)** with no
per-product code, because the agent develops them all.

**Non-goals:** code quality, WPCS, Plugin Check, lint, security grep, market analysis. Those are noise
here and run separately. This answers one question: *does the feature the agent just touched actually
work, in every layer it claims?*

## Architecture — three pieces, all reusable across products

```
/wp-plugin-onboard  ──emits──▶  audit/manifest.json (schema v2: app + UX + wiring)
   (improved skill)                          │
                                             ▼
                          MCP generic engine  (this server)
                          reads manifest → derives invariants → runs checks
                          via `wp eval-file <bundled-engine.php>` on the live site
                                             │
                          ┌──────────────────┼───────────────────┐
                   confirmed corrections   cert-oracles.json   Stop-hook gate
                   returned to the agent   (1 row per bug,      (blocks the agent
                   (deep audit, on demand) the only memory)     from finishing dirty)
```

1. **Onboard skill** produces the manifest (schema v2 below). The manifest is the only thing that is
   per-plugin, and it is *generated from the plugin's own code*, not hand-authored.
2. **MCP generic engine** is plugin-agnostic. Point it at `(plugin_path, wp_path)`; it reads that
   plugin's manifest and runs the behavioural checks by executing a **single bundled PHP engine** via
   `wp eval-file` against the live site. No per-plugin PHP, no per-plugin `cert` command. The existing
   `wp buddynext cert` becomes redundant — the generic engine replaces it.
3. **Stop hook** wires the engine into the agent's real-time workflow (the part that makes it not-waste).

Why the engine runs via `wp eval-file`: behavioural verdicts need the live runtime (DB, hooks, internal
REST dispatch). Shipping the engine in the MCP and injecting it with `wp eval-file` gives that runtime
on *any* site without installing anything in the plugin — the scalable form for 100+ products.

## Manifest schema v2 — the complete contract (what onboard must emit)

The plugins are **REST/application layer first, UX on top.** The manifest captures both layers and the
wiring between them. New/enriched sections (on top of today's `plugin, ajax, admin_pages, tables,
hooks_fired, capabilities, cron, blocks, shortcodes, generated`):

### A. Application / REST layer (foundation)
- `rest[]` per endpoint: existing `route, methods, handler, permission, purpose` **plus**
  - `request_args` — name, type, required, sanitize.
  - `response_keys` — keys the endpoint returns. *(hard extraction — see Confidence.)*
  - `gated_by` — the option/feature-flag that enforces the route.
- `capabilities ↔ routes` — which cap each route requires.
- `services[]`: existing `key, class, purpose` **plus** `reads` / `writes` (tables + options touched).

### B. Settings / control layer
- `options[]` *(new)* — `name, default, written_at` (admin tab/field), `read_at[]` (consumer
  `file:line`), `enforced_at[]` (UI gate + REST gate), `gates` (routes/features controlled).
- `features[]` *(new, from FeatureRegistry)* — `slug, tier, gates` (routes + templates + services +
  admin page controlled), `enforced_at[]`.

### C. UX / template layer (on top of REST)
- `templates[]` *(new)* — `slug, file, loader_args` (vars the loader supplies), `vars_used` (vars the
  template references), `consumes` (REST routes/data it renders), `belongs_to` (feature/route).
- `frontend_js[]` *(enrich frontend_assets.js)* — `module, calls_rest[]` (routes fetched),
  `reads_keys[]` (response keys consumed), `renders_into` (template/DOM). *(reads_keys — see Confidence.)*

### D. Cross-layer wiring (the spine)
- `features[]` is the grouping that ties **flag → {routes, templates, js, admin_page, option,
  service}**. Without it there is no way to check 3-layer reachability / missing UX.
- Links recorded: `REST → JS → template`, `option → gating route + gating UI`, `hook → listener`.

### E. Events
- `hooks_fired[]` *(enrich)* — add `listeners[]` so notification/event wiring is checkable (the
  @mention + email-CTA bugs were this class).

### Extraction confidence (honesty, so it is not secretly half-cooked)
- **High (statically reliable, the bulk):** request_args, options wiring, features grouping, template
  loader_args + vars_used, hooks↔listeners, services reads/writes, caps↔routes.
- **Low (dynamic):** `rest.response_keys`, `frontend_js.reads_keys`. Onboard extracts the literal
  cases (literal array returns, `apiFetch` destructuring) and marks the rest `confidence:"low"`. Checks
  that depend on low-confidence data run only where confidence is high; elsewhere they report
  "unverifiable — needs annotation", **never a false pass**.

## Checks (the engine's vocabulary) — each powered by manifest v2

| Check | Manifest input | Asserts (runtime) | Bug class |
|---|---|---|---|
| `contract` | options wiring + features.gates | flip setting OFF/ON → REST behaviour flips | dead toggle |
| `boot` | rest routes | dispatch route → no fatal/500 | fatals |
| `auth` | rest.permission + caps↔routes | route rejects the unauthorised caller | broken access |
| `wiring` | features grouping (3 layers) | feature responds in frontend + backend + API | half-wired / missing UX |
| `render` | templates loader_args vs vars_used | render template with loader args → no undefined-var | template drift |
| `shape` | rest.response_keys ↔ js.reads_keys | response contains the keys the JS reads | REST↔JS drift |
| `event` | hooks ↔ listeners | firing the event reaches its listener (e.g. notification row) | broken notifications |

`contract` + `boot` are already proven (the existing buddynext cert). The rest become buildable the
moment the manifest carries their inputs — which is exactly why onboard comes first.

## Storage — `audit/` must never outgrow the plugin

Two durable, bounded files only:
- `manifest.json` — regenerated from code; bounded by plugin size; never accretes.
- `cert-oracles.json` — the system's entire memory; one compact row per confirmed issue
  (`{id, kind, route, expect}`); grows ~1 line per real bug.

Everything else is ephemeral, never written into the plugin: the run ledger → `/tmp` (gitignored);
detective candidates + confirmed corrections → returned to the caller in-memory. The old
`learn_from_basecamp` per-card cache trees are not reintroduced.

## Real-time wiring — the Stop hook (makes it not-waste)

- A Claude Code `Stop` hook runs the MCP engine on the surfaces the agent touched this session.
- Cheap when nothing changed: `git diff --name-only` vs the session baseline; no plugin edit → exit 0.
- Resolves the target from `$CLAUDE_PROJECT_DIR/.cert.json` (`{wp_path}`), else env; absent → no-op.
- Baseline-diff: blocks only on failures the agent **introduced this session**, never pre-existing debt.
- New confirmed failure → returns `{"decision":"block","reason": <corrections>}`; the agent cannot
  finish until it fixes and re-runs clean. The cert verdict is fed back as the correction.
- Secondary: MCP `wppqa_audit` runs the whole-plugin engine on demand (deep audit), same engine.

## Build order (each step shippable + verified; nothing deferred as vapor)

1. **Onboard enrichment → manifest v2.** Improve `/wp-plugin-onboard` to emit sections A–E above (with
   confidence flags). Verify: run on buddynext, assert the manifest contains templates with
   loader_args/vars_used, options wiring, features grouping, hooks↔listeners; spot-check accuracy.
2. **MCP generic engine.** One bundled PHP engine + the MCP runner that executes it via `wp eval-file`
   against any plugin from its manifest. Port `contract`+`boot` to it first (parity with buddynext
   cert), then add `wiring`, `render`, `shape`, `auth`, `event` as their manifest inputs exist.
   Retire `wp buddynext cert` once parity holds. Verify each kind: break-it → red, fix → green.
3. **Stop-hook gate.** The hook script + `.cert.json` + `settings.json` registration + CLAUDE.md note.
   Verify: planted dead toggle blocks the turn with the correction; fix → finishes; pre-existing
   failure does not block; no-edit turn exits <50ms.
4. **MCP surface cleanup.** `wppqa_audit` orchestrator returns the confirmed-correction list; retire the
   advisory tools whose job the engine now does deterministically.

## Testing

- Onboard: golden-manifest fixture for buddynext — assert each v2 section is present + shaped; accuracy
  spot-checks on known features (reactions flag → its route + template + enforcement recorded).
- Engine kinds: each goes red on a seeded break, green on fix (break-it-watch-it-red).
- Loop: planted dead toggle → engine confirms → oracle persisted → re-run green; can't recur.
- Cross-product: run onboard + engine on a *second* plugin (no per-plugin code) → it works.
- Storage: after a full run, `audit/` holds only `manifest.json` + `cert-oracles.json`.
