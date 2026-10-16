# Portfolio QA Standard — All Surfaces

The uniform bar every Wbcom plugin **and theme** ships against, on every
release. One list, applied identically to a 6-month-old plugin and one created
tomorrow. Derived from an audit of this QA server's 45 modules (see
**SURFACE-COVERAGE-MAP.md**) plus the portfolio big-site + design-system rules.

Each requirement is tagged:

- **AUTO** — a tool in this server enforces it. Named in `Enforced by`.
- **PARTIAL** — a tool checks it but with a known blind spot; finish by hand.
- **MANUAL** — no tool enforces it yet; a human/LLM must verify. These are the
  roadmap for the tool (tracked in "Tool roadmap" at the end).

A release is **portfolio-ready** only when every AUTO/PARTIAL check passes AND
every MANUAL check has a recorded human verdict. "The linter was green" is not
readiness — a green run can mean a check silently skipped (see coverage map §1).

---

## 1. Static code quality

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 1.1 | No `alert()`/`confirm()`; no raw `$_POST`/`$_GET` iteration; no inline `onclick` | AUTO | plugin-dev-rules-checker |
| 1.2 | WPCS + PHPStan + `php -l` + Plugin Check pass — **with the config actually present** (a skipped linter is a fail) | AUTO | code-quality-checker + readiness-bar (config presence) |
| 1.3 | Every `$wpdb` call uses `prepare()`; no `unserialize`/`extract`/`create_function` on input | PARTIAL | code-quality (line-grep; eyeball multi-line) |
| 1.4 | No duplicated logic across files or the Free/Pro boundary | PARTIAL | dup-function-checker (exact-hash only) |
| 1.5 | Enum/whitelist value sets agree across every layer that names them | PARTIAL | enum-consistency-checker (literals only) |
| 1.6 | No dead code — every function/method/template is reachable | MANUAL | orphan-checker is advisory only |

## 2. Security & authorization

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 2.1 | Every AJAX/REST write verifies a nonce | AUTO | scanner.analyzeWiring |
| 2.2 | Every nonce is paired with a `current_user_can()` capability check | PARTIAL | plugin-dev-rules (50-line window) |
| 2.3 | Every REST route has a real `permission_callback` (never `__return_true` on writes) | AUTO | role-matrix-prober |
| 2.4 | Role matrix: guest/subscriber/editor/admin each get the correct status on every route×method + AJAX action | AUTO | role-matrix-prober |
| 2.5 | **Data scoping**: user A cannot read/modify user B's rows | MANUAL | role-prober checks status, not ownership |
| 2.6 | Nonce action name at creation == action at verification | MANUAL | not checked |

## 3. Cross-layer wiring (the "dead button" class)

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 3.1 | Every JS AJAX action has a live PHP handler; no orphan `data-action` selectors | AUTO | scanner.analyzeWiring |
| 3.2 | Every setting saved in admin is read somewhere non-admin | PARTIAL | wiring-completeness (generic-name blind spot) |
| 3.3 | Every JS property read exists in the REST response envelope | PARTIAL | rest-js-contract / rest-flow (no live, no nested) |
| 3.4 | Every `$var` a template reads is supplied by its loader/resolver contract | AUTO | template-contract-checker |
| 3.5 | Every data store written is read back (no stale-read / orphan) | PARTIAL | data-cross-reference (PHP only) |
| 3.6 | JS event-handler selectors match rendered markup classes | MANUAL | not checked |
| 3.7 | `block.json` `render`/`viewScript` exists; attributes match render usage | MANUAL | not checked |
| 3.8 | `add_shortcode` callback exists for every `[shortcode]` used | MANUAL | not checked |
| 3.9 | Every `do_action`/`apply_filters` emitted has (or intentionally lacks) a consumer; documented hooks fire | MANUAL | template-checker checks presence only |
| 3.10 | `wp_schedule_event` hook has an existing callback; custom `cron_schedules` are registered | MANUAL | not checked |
| 3.11 | `wp_localize_script` handle matches an enqueued handle | MANUAL | not checked |
| 3.12 | REST `args` schema params match `$request['param']` reads | MANUAL | not checked |

## 4. Database & big-site readiness (2000+ rows on day one)

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 4.1 | dbDelta hygiene: `$wpdb->prefix`, PRIMARY KEY, `charset_collate`, `upgrade.php` | AUTO | db-checker |
| 4.2 | Uninstall removes every table/option; large options `autoload=false`; no orphan options/transients | AUTO | db-checker |
| 4.3 | **Every WHERE/ORDER BY/JOIN column on a custom table has a secondary index** | AUTO | perf-scale-checker (`missing-index`) |
| 4.4 | **Every list query has LIMIT; counts use `COUNT(*)`, never `count(list_all())`** | AUTO | perf-scale-checker (`unbounded-read`, `count-via-listall`) |
| 4.5 | **No N+1 — per-row queries inside a loop are batch-fetched** | AUTO | perf-scale-checker (`n-plus-one`) |
| 4.6 | **Shared reads are cached with a clear invalidation path on writes** | MANUAL | not checked (roadmap Wave 1.5) |
| 4.7 | **Lists offer filter-by-* and sort-by-* on the primary discriminator** | MANUAL | behavioral — seeded-fixture journey |
| 4.8 | **UI handles multi-actor concurrency (already-resolved/deleted/taken)** | MANUAL | behavioral — seeded-fixture journey |

> §4.3–4.5 are now enforced statically by `wppqa_check_scale` (keyed off the
> plugin's own CREATE TABLE + `$wpdb` usage; skips a target with no custom
> tables). §4.6–4.8 remain MANUAL — seed 1000+ posts / 500+ users with WP-CLI
> and verify by hand. Do not accept "looks fine on 5 rows."

## 5. UX / design system

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 5.1 | WCAG 2.1 AA: labels, alt text, aria, keyboard reach, `:focus-visible`, icon accessible-names | AUTO | a11y-checker |
| 5.2 | **Color contrast meets AA ratios** | MANUAL | no contrast math exists |
| 5.3 | Colors are tokens only — no raw hex outside `var(--prefix-*)` | AUTO | ux-guidelines-checker |
| 5.4 | Icons are Lucide only — no Dashicons/emoji/FA | AUTO | ux-guidelines-checker |
| 5.5 | Admin screens follow the 6 page patterns + `.prefix-page-header`/`.prefix-admin-card` | AUTO | admin-evaluator + visual-regression |
| 5.6 | Every async surface has empty + error + loading states | PARTIAL | ux-checker/frontend (empty/error coarse; loading barely) |
| 5.7 | ≤4 breakpoints; tap targets ≥40px | AUTO | plugin-dev-rules-checker |
| 5.8 | **Layout stacks to one column at 390px; no horizontal overflow** | MANUAL | only `@media` presence checked |
| 5.9 | **RTL: logical properties (`margin-inline`), never `margin-left/right`** | MANUAL | zero RTL detection |
| 5.10 | **Dark mode via real `prefers-color-scheme`/`[data-theme]` blocks, tokens only** | MANUAL | only raw-hex proxy |
| 5.11 | **Themed `<a>` buttons: hover/focus/visited/active all styled** | MANUAL | not checked |
| 5.12 | **Verified by LOOKING at a screenshot at 390/768/desktop — not a DOM assertion** | MANUAL | visual-regression is 4 signals at 1 desktop viewport |

## 6. i18n / lifecycle / seam

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 6.1 | Text domain loaded; `languages/` + `.pot` present | AUTO | code-quality-checker |
| 6.2 | **Every `__()/_e()` uses the correct text domain; translator comments present** | MANUAL | domain-mismatch not checked |
| 6.3 | readme Stable tag == plugin-header Version; tested-up-to is current | AUTO | marketing-evaluator |
| 6.4 | Activation/deactivation/uninstall present and guarded | AUTO | plugin-dev-rules + gap-analyzer |
| 6.5 | **No `_deprecated_function` / deprecated-WP-API usage** | MANUAL | not detected |
| 6.6 | **DB schema version bumped when schema changes** | MANUAL | not detected |
| 6.7 | **Autoloading sane (PSR-4/classmap); no baked worktree paths** | MANUAL | not checked |
| 6.8 | **Bundled SDK/runtime shipped in the zip is scanned** (not hidden under `tests/bin/build/dist`) | MANUAL | those dirs are excluded from scan |
| 6.9 | **Free→Pro seam: Pro extends Free only through documented hooks/filters** | MANUAL | not verified |

## 7. Three entry points per data store

Every custom table / data feature is reachable through all three, in the same
release (or the exception is documented in `audit/manifest.json`):

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 7.1 | Frontend UX for members | PARTIAL | frontend-evaluator (presence) |
| 7.2 | Backend/admin UI for the site owner | AUTO | admin-evaluator |
| 7.3 | REST API to read/populate it | AUTO | api-checker + role-matrix-prober |

## 8. Product / readiness meta

| # | Requirement | Status | Enforced by |
|---|---|---|---|
| 8.1 | Meets category feature expectations vs the leaders | AUTO (plugins) | category-expectations — **no theme category yet** |
| 8.2 | readme messaging, screenshots, changelog, upgrade flow | AUTO | marketing-evaluator |
| 8.3 | Passes "the bar" (17 readiness items) | AUTO | readiness-checklist |
| 8.4 | Functional test coverage never regresses | AUTO | qa-coverage-checker (appears-in-source only) |
| 8.5 | Tests actually assert behavior | MANUAL | coverage counts presence, not assertions |

---

## How to run the bar

```
wppqa_audit_plugin      # aggregate: rules + category + marketing + report (A+..F)
wppqa_readiness         # "the bar" — 17-item release scorecard
wppqa_check_*           # per-surface: a11y, api, database, templates, roles, wiring...
wppqa_certify           # functional certification via the plugin's cert engine
```

No single command asserts every surface above — the AUTO checks are spread
across tools and the MANUAL rows are, by definition, off-tool. Until a unified
gate exists, a release runs `audit_plugin` + `readiness` + the relevant
`check_*` tools, then a human records the MANUAL verdicts.

## Tool roadmap (close the MANUAL rows, highest-leverage first)

1. **Big-site gate (§4.3–4.8)** — the largest gap. Static: index-vs-WHERE/ORDER-BY/JOIN, unbounded-SELECT, `count(list_all())`, N+1-in-`foreach`. Runtime: seed 1000+ rows and time the hot list. Extend db-checker + a new `perf-scale-checker`.
2. **Wiring completeness (§3.6–3.12)** — JS selector↔markup, block.json↔render, shortcode↔handler, hook emit↔consume, cron↔callback, localize↔enqueue, nonce action-name. Mostly static; extend scanner + the `flow/` graph.
3. **Design-system runtime (§5.2, 5.8–5.12)** — real contrast math; render at 390/768/desktop + dark + RTL and read the screenshot; `margin-left/right` + `left:/right:` grep for RTL. Extend visual-regression + ux-guidelines.
4. **Data scoping + auth (§2.5, 2.6)** — probe cross-user reads; nonce action-name match. Extend role-matrix-prober.
5. **Execute browser-runner's generated specs** — it already emits them; wire `npx playwright test` / Playwright MCP so §5.12 stops being manual.
6. **Theme support (§8.1)** — add a theme category + theme-specific checks (theme.json, template hierarchy, block patterns).
7. **Hygiene** — wire competitive-analyzer into `audit_plugin` or retire it; remove dead `multilingual`/`media` categories; drop report-builder orphan exports; fix readiness tool description (PHPUnit item); reconcile source↔deployed tool drift; stop excluding bundled-SDK dirs when a `libs/` SDK is present.
