# QA Server Roadmap — Implementation Plan

How to close every MANUAL row in **PORTFOLIO-QA-STANDARD.md** so the tool
enforces the full portfolio bar deterministically. Grounded in the actual
manifest/checker contract and the flow-graph + PHP-AST substrate (audit
2026-09-13, `master` @ `999a84f`).

## Prime directive: site-type-agnostic

We never know what we're pointed at — plugin or theme, WooCommerce or LMS or a
blank utility, 5 rows or 5 million. Every checker below obeys:

1. **Manifest-driven** — key off facts the scanner already emits; never assume a
   category, framework, or theme.
2. **Degrade to `skipped`, never fail-by-absence** — no custom tables → the
   index checker skips; no blocks → the block checker skips. Absence of a
   surface is not a defect.
3. **Precision over recall** (the repo's existing principle) — a finding must be
   statically confirmable or it's an `info` advisory, not an `error`. Everything
   supports `audit/*.json` + `.wppqa.yml` overrides and a baseline so counts
   never grow.
4. **Same code path for plugin and theme** — the scanners walk `pluginPath`;
   Wave 6 makes that path a theme root too, so a11y/ux/template checks work
   unchanged.

## Registration recipe (every new checker)

1. `types.ts` — add the `TestCategory` member.
2. `src/<name>-checker.ts` — export `check<Name>(manifest: PluginManifest, siteUrl?): CheckerResult`. Build ids via `generateTestId(category)`; `failed = issues.filter(i => i.type==='error').length`; `passed = max(0, checks - failed)`.
3. `server.ts` — add `case 'wppqa_check_<name>'` + a handler calling `getCachedManifest(path)`.
4. `tools.ts` — push the `Tool` def; add to `EXCLUDED_NON_FUNCTIONAL` only if it's non-functional/advisory.
5. `report-builder.ts` — add a `CATEGORY_WEIGHTS` entry (else it scores at weight 1 and barely moves the grade).
6. Include it in `wppqa_audit_plugin` and the new `wppqa_audit_all` gate (Wave 7).
7. Test: `src/__tests__/<name>.test.ts` with one RED distractor + one GREEN case (repo convention).

---

## Wave 0 — Shared extraction seams (do first; Waves 1–2 depend on it)

Two seams unlock most of the roadmap. Build once.

**S0a — PHP-AST visitors** (`php-ast/extract-graph.php`, nikic/php-parser already vendored)
Add visitors emitting new `PhpFacts` arrays, ingested by `ingestPhpFacts`:
- `sqlQueries[]` — {file, line, raw, tables[], whereCols[], orderByCols[], joinCols[], hasLimit, kind:'select'|'insert'|'update'|'delete', inLoop:bool}
- `tableKeys[]` — CREATE TABLE PRIMARY/UNIQUE/KEY/INDEX column sets (parseColumnNames currently drops these)
- `loops[]` — foreach/for/while nodes with child query-call sites (for N+1)
- Populate the declared-but-empty `table` and `option` graph node kinds + `fires` edge (declared, never emitted — needed for hook pairing).
- Parameterize the hardcoded `buddynext_*` template-helper list (extract-graph.php:113) so it works on any plugin.
- Effort: **M**. Parser is loaded; these are 3 straightforward visitors.

**S0b — scanner.ts regex scanners** (feed the live manifest)
- `scanEnqueueScripts()` — `wp_enqueue_script(handle, src, deps, ver, ...)` → `enqueuedHandles[]` (mirror `scanLocalizeScripts`). Today only `hasEnqueueCalls: bool` exists.
- Extend `scanBlocks()` to capture `render`/`render_callback`/`viewScript` from block.json/register calls.
- Extend `scanTemplateSelectors()` to a full class-list per template (today it's a btn/action subset).
- Effort: **S**. Small regex additions.

---

## Wave 1 — Big-site / performance-scale (largest gap) — SHIPPED (regex)

New module `src/perf-scale-checker.ts`, category `performance-scale`, tool
`wppqa_check_scale`. **Delivered** as a self-contained regex checker (1.1–1.4
below) with unit tests, verified on real code (found true-positive N+1s in
bp-business-profile). Degrades to `skipped` when there are no custom tables and
no `$wpdb`. **Pending upgrade:** move SQL/CREATE-TABLE/loop extraction to the
S0a PHP-AST sidecar to cut regex false-negatives (e.g. `$table` var indirection
the normalizer can't resolve today), and add 1.5/1.6 cache checks.

| # | Check | Severity | Data |
|---|---|---|---|
| 1.1 | Every WHERE/ORDER BY/JOIN column on a custom table has a KEY/INDEX | high | S0a `sqlQueries` × `tableKeys` |
| 1.2 | List/loop-feeding SELECT has no LIMIT (unbounded read) | high | S0a `hasLimit` |
| 1.3 | `count( Model::list_all() )` / `SELECT *` used for a count instead of `COUNT(*)` | medium | S0a + grep |
| 1.4 | Query inside a `foreach`/`for` (N+1) not batch-fetched | high | S0a `loops`+`inLoop` |
| 1.5 | Hot repository read path has no cache call (`wp_cache_*`/transient) | low/info | graph `reads` + grep near repo methods |
| 1.6 | (advisory) Cache write path has no invalidation on the matching write | info | pair read cache-key vs write |

Filter+sort on large lists (§5.7) and multi-actor concurrency (§4.8) are
behavioral, not statically provable — they stay in the journey-audit LLM
briefing but get a **dedicated `performance-scale` journey template** with a
seeded 1000+ row fixture (WP-CLI) so the LLM verdict is grounded, not guessed.
Effort: **L** (the flagship item).

---

## Wave 2 — Wiring completeness (mostly consumes existing facts — cheap, high value)

Extend `scanner.analyzeWiring` + a new `src/wiring-graph-checker.ts` (category
`wiring`, folded into the existing wiring tool). Each degrades to skip when its
surface is absent.

| # | Check | Data source | New work |
|---|---|---|---|
| 2.1 | JS event selector matches a rendered markup class | `wiring.jsEventHandlers[].selector` (exists) × S0b class list | join only |
| 2.2 | `wp_localize_script` handle matches an enqueued handle | `wiring.localizeScripts[].handle` (exists) × S0b `enqueuedHandles` | join only |
| 2.3 | Shortcode callback resolves to a real symbol | `shortcodes[].callback` (exists) × graph symbols | join only |
| 2.4 | `do_action`/`apply_filters` emitted has a consumer; documented hook actually fires | `hooks.provided` + `hooks.consumed` + S0a `fires` edge | pairing logic |
| 2.5 | `wp_schedule_event` hook has a real `add_action` callback | `cronJobs[]` (exists) + S0a registrations | real pairing (cron callback is a placeholder today) |
| 2.6 | REST `args` params match `$request['param']` reads (both directions) | `restRoutes[].requestArgs` (exists) + grep param reads | grep reads |
| 2.7 | block.json `render`/`viewScript` exists; declared attributes are used in render | `blocks[].attributes` (exists) + S0b `render` | resolve render file |
| 2.8 | Nonce action-name at create == action at verify | `wiring.jsAjaxCalls[].nonceKey` + scanner nonce facts | name compare |

Effort: **M total** — 2.1–2.3, 2.6 are joins over facts that already exist;
2.4/2.5/2.7 need Wave 0. Start 2.3/2.6 before Wave 0 (no dependency).

---

## Wave 3 — Design-system runtime (extend a11y + ux-guidelines + visual-regression)

| # | Check | Where | Kind | Effort |
|---|---|---|---|---|
| 3.1 | Real WCAG contrast-ratio math (token pairs + rendered computed styles) | a11y-checker (replace the misnamed `checkColorContrast`) | static+runtime | M |
| 3.2 | RTL: flag `margin/padding-left/right`, `left:/right:`, `text-align:left` → logical props | ux-guidelines-checker (already scans CSS) | static | S |
| 3.3 | Render at **390 / 768 / desktop** + dark + RTL; assert no horizontal overflow, rows stack, themed `<a>` hover/focus/visited/active styled | visual-regression-checker (already renders; add viewports + reads) | runtime | L |
| 3.4 | Real dark-mode blocks present (`prefers-color-scheme`/`[data-theme]`); no hardcoded color inside them | ux-guidelines + 3.3 render | static+runtime | M |
| 3.5 | 40px tap target + ≤4 breakpoints (already AUTO in plugin-dev-rules) — cross-wire into the design report | report wiring | — | S |

3.3 is the "LOOK at the screenshot" enforcement — capture the PNG, run the
existing overflow/stacking asserts, and surface the image path so a human (or an
LLM sub-agent) reads it. Effort: **L**.

---

## Wave 4 — Auth depth (extend role-matrix-prober)

| # | Check | Effort |
|---|---|---|
| 4.1 | Data-scoping: seed a row as user A, attempt read/write as user B over REST/AJAX, expect denial | L (needs fixture users + seed data) |
| 4.2 | Resolve closure/`<unresolved>` permission callbacks instead of defaulting every role to "success" (current false-negative) | M |
| 4.3 | Nonce-authenticated endpoints (currently `skipped`) get probed with a real nonce | M |

4.1 is the highest-value security gap (cross-tenant reads). Needs the reference
Docker site + WP-CLI-seeded users. Effort: **L**.

---

## Wave 5 — Execute the browser specs (browser-runner already generates them)

browser-runner emits `.spec.ts` but never runs them (`passed:0`). Wire a
transport like cert-runner:
- **CI path:** shell `npx playwright test` against the generated specs, parse the
  JSON reporter into `CheckerResult` (real pass/fail, not skipped).
- **Interactive path:** drive the same journeys through the **Playwright MCP**
  tools (the project rule: use the MCP, never author standalone Playwright
  scripts). browser-runner's generated specs are the QA tool's own harness, so
  CI execution of them is acceptable; interactive verification goes through MCP.
- Report the screenshot artifacts (ties into Wave 3.3).
- Effort: **M**.

---

## Wave 6 — Theme support (currently zero)

| # | Work | Effort |
|---|---|---|
| 6.1 | Detect theme roots: `style.css` header, `theme.json`, `templates/`+`parts/` (block theme), `functions.php`; set `manifest.kind:'plugin'\|'theme'` | M |
| 6.2 | Make a11y / ux-guidelines / template / frontend checkers walk theme dirs (mostly free — they scan PHP/CSS already) | S |
| 6.3 | Theme-specific checks: `theme.json` schema + token coverage, template-hierarchy completeness, block patterns registered, no plugin-territory logic (CPTs/business logic in a theme), RTL stylesheet present, text-domain == theme slug | M |
| 6.4 | Add a `theme` category to category-expectations with theme-leader expectations | M |

Effort: **L** overall, but 6.2 is nearly free and delivers most a11y/UX coverage
to themes immediately.

---

## Wave 7 — Hygiene & the unified gate

- **`wppqa_audit_all`** — one tool that runs every `check_*` + `readiness` + the
  new waves, and emits the MANUAL-verdict prompts for what can't be automated.
  The missing "run everything" gate.
- Wire **competitive-analyzer** into `audit_plugin` or retire it (currently
  orphaned behind an excluded tool).
- Remove dead `multilingual`/`media` `SoftwareCategory` values.
- Drop report-builder orphan exports (`formatReport`, `exportJson`) or wire them.
- Fix readiness tool description (claims a PHPUnit-tests bar item that
  `defineBar()` lacks) — either add the item or fix the text.
- Reconcile source↔deployed tool drift (`wppqa_readiness`/`_portfolio` in source,
  absent from the live snapshot).
- **Stop excluding `tests/bin/build/dist`** from scanning when a `libs/` SDK is
  present (EDD-SDK packaging standard — bundled runtime must be scanned).
- Add `CATEGORY_WEIGHTS` entries for every new category from Waves 1–6.
- Effort: **M**.

---

## Sequencing

```
Wave 0 (S0a, S0b) ─┬─> Wave 1 (perf-scale)      [flagship]
                   └─> Wave 2 (2.4, 2.5, 2.7)
Wave 2 (2.3, 2.6) ── independent, start anytime
Wave 3 (3.2 static) ── independent · (3.1/3.3/3.4 runtime) after render harness
Wave 4 ── after Docker fixture users
Wave 5 ── browser-runner exists; needs Playwright transport
Wave 6 ── mostly independent (6.2 is free)
Wave 7 ── anytime; the audit_all gate lands last, after new checkers exist
```

Priority order by leverage: **Wave 0 → 1 → 2 → 3 → 5 → 4 → 6 → 7**.

## Effort roll-up

| Wave | Effort | Unlocks |
|---|---|---|
| 0 Shared seams | M | Waves 1 & 2 |
| 1 Perf-scale | L | the entire big-site bar |
| 2 Wiring | M | 8 dead-button-class bugs |
| 3 Design runtime | L | RTL, dark, 390px, contrast, `<a>` states |
| 4 Auth depth | L | cross-tenant data-scoping |
| 5 Execute specs | M | real E2E pass/fail |
| 6 Theme support | L | half the portfolio the tool can't see today |
| 7 Hygiene + gate | M | one command, no orphans |

Each wave ships independently and moves specific rows in
PORTFOLIO-QA-STANDARD.md from MANUAL to AUTO — update that doc's Status column in
the same PR that lands the checker.
