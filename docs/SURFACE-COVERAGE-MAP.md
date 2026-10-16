# Surface Coverage Map

What every module in this QA server actually checks, how deeply, whether it is
reachable from a tool, and where the blind spots are. Audit date: 2026-09-13,
`master` @ merge `033f72b`, 45 `src/*.ts` modules.

Read this with **PORTFOLIO-QA-STANDARD.md** — this is the "what the tool covers
today"; that is the "what every plugin/theme must satisfy" bar. A gap here is a
row in that doc marked *manual*.

## Legend

- **Depth**: `full` (real parse / live probe) · `partial` (heuristic, high false-negative) · `stub` (generates or delegates, asserts nothing) · `wrapper` (thin, real logic in `flow/` sidecar).
- **Reach**: `tool` (an exposed MCP tool hits it) · `audit_plugin` (only via the aggregate) · `hidden` (only via an excluded tool) · `orphan` (built, no caller).

---

## A. Static code quality

| Surface | Module | Depth | Reach | Key blind spot |
|---|---|---|---|---|
| PHP static analysis (WPCS/PHPStan/php -l/Plugin Check) | code-quality-checker | full | tool | **degrades to grep or silently skips when the tool/config is absent** — a clean run can just mean WPCS wasn't installed |
| Security anti-patterns (unprepared `$wpdb`, echo superglobal, `unserialize`/`extract`, LFI/SSRF) | code-quality-checker, scanner | partial | tool | line-based grep, misses multi-line; self-suppresses when PHPCS present |
| Dev-rulebook (alert/confirm ban, raw `$_POST` iteration, nonce+cap pairing, activation nesting, uninstall guard, `-1` inputs, inline onclick, **>4 breakpoints, <40px tap target**) | plugin-dev-rules-checker | full | tool | nonce↔cap uses a 50-line window; tap/breakpoint are CSS heuristics |
| Duplicate code | dup-function-checker | wrapper | audit_plugin | exact body-hash only; no normalized/near-dup match |
| Enum drift across layers | enum-consistency-checker | full | tool | string-literals only; misses constants/DB-backed enums |
| Wrong-layer function usage | canonical-usage-checker | partial | audit_plugin | rules live in `flow/canonical-rules.ts`; only as good as that list |

## B. Cross-layer wiring

| Surface | Module | Depth | Reach | Key blind spot |
|---|---|---|---|---|
| AJAX wiring (JS action→PHP handler, dead handler, missing nonce, orphan `data-action`) | scanner.analyzeWiring | full | tool | nonce detection is a 2000-char proximity window; misses nonce in sub-methods |
| Settings saved-but-never-read | wiring-completeness-checker | full | tool | large generic-name blocklist silently ignores real half-wired generic keys |
| REST response ↔ JS property access | rest-js-contract-checker, rest-flow-checker | partial/wrapper | tool | no live HTTP; empty/dynamic shapes skipped; nested/destructured data unhandled |
| Template variable contract (loader/resolver → `$var`) | template-contract-checker | full | tool | conservative/false-negative-biased; no contract = skip |
| Data store read/write cross-reference (meta/option/transient/columns) | data-cross-reference | full | audit_plugin | PHP only (JS not implemented); dynamic SQL / `SELECT *` → table-level |
| Orphan / dead code | orphan-checker, template-usage-checker | wrapper | audit_plugin | self-labeled unconfirmable; advisory info, never fails |
| Hook availability (override support, `do_action`/`apply_filters` presence) | template-checker | full | tool | checks presence, **not** that hooks fire or are consumed |

## C. Runtime / behavior

| Surface | Module | Depth | Reach | Key blind spot |
|---|---|---|---|---|
| Live REST + AJAX HTTP (≥500, unauth write 200, AJAX `0`/`-1`/HTML) | api-checker | full | tool | status codes only, no body/shape; GET-only REST probe |
| Role / capability matrix (guest/subscriber/editor/admin × route×method + AJAX) | role-matrix-prober | full | tool | admin-detection by name pattern; unresolved callbacks default to "success"; **no data-scoping** (user A reading user B's rows) |
| Browser E2E | browser-runner | **stub** | tool | **generates `.spec.ts` but never runs them** — `passed:0`, all skipped |
| Rendered-DOM design-system render | visual-regression-checker | partial | tool | 4 class signals, single 1440×900 viewport; no diffing, no dark/RTL/responsive render |
| Functional certification | cert-runner | full (delegate) | tool | zero visibility into what the external `cert-engine.php` asserts; silent if CLI missing |
| Test-coverage accounting (manifest vs test corpus) | qa-coverage-checker | full | tool | "action string appears in test source" — does not verify the test asserts anything |
| User-journey coverage | journey-audit | stub | tool | delegates auditing to LLM sub-agents; coverage match is substring; no code assertions |

## D. Database & big-site readiness

| Surface | Module | Depth | Reach | Key blind spot |
|---|---|---|---|---|
| Schema hygiene (dbDelta, PRIMARY KEY, charset_collate, `upgrade.php`, uninstall cleanup, `autoload=false`, orphan options, transient cleanup) | db-checker | full | tool | regex; misses concatenated/heredoc schemas; string-literal keys only |
| **Secondary indexes on WHERE/ORDER BY/JOIN columns** | — | **none** | — | db-checker verifies PRIMARY KEY only |
| **Pagination / LIMIT / OFFSET / COUNT(\*) vs `count(list_all())`** | — | **none** | — | not checked by any module |
| **N+1 queries (beyond a single `get_post_meta` grep)** | — | **none** | — | not checked |
| **Cache adoption + invalidation on writes** | — | **none** | — | not checked anywhere |
| **Multi-actor concurrency (already-resolved/deleted/taken)** | — | **none** | — | not checked |

> Big-site readiness exists only as **advisory prose in journey-audit's LLM
> briefings** ("expect LIMIT or cursor pagination"), never as a deterministic
> gate. This is the single largest gap versus the portfolio big-site checklist.

## E. UX / design system

| Surface | Module | Depth | Reach | Key blind spot |
|---|---|---|---|---|
| WCAG a11y (labels, alt, aria, focus-visible, icon accessible-name, keyboard alt, positive tabindex) | a11y-checker | full | tool | **no real contrast-ratio math** (the `checkColorContrast` fn only checks outline removal); no heading-order/landmark/lang |
| Design tokens (raw hex outside `var(--*)`, raw px, Lucide-only, `:focus-visible`) | ux-guidelines-checker | full | tool | raw-hex flag is the **only** dark-mode proxy; no RTL; scans `assets/**` + `admin/views` only |
| Admin IA & settings patterns (crowding, tabs, defaults, menu caps, POST nonce/required) | admin-evaluator | full | tool | overlaps ux-checker on notices |
| Admin copy / feedback (field descriptions, jargon, empty-state, success feedback) | ux-checker | partial | tool | empty-state/success are plugin-wide any/none booleans |
| Frontend visitor surfaces (shortcode return, block SSR, modal a11y, form UX, `@media` presence) | frontend-evaluator | full (breadth) | tool | responsive check is binary presence-of-`@media`; no breakpoint values or stacking |
| Editor layout bias (sidebar-heavy metadata forms) | editor-layout-bias-checker | partial | audit_plugin | one niche Learnomy-derived pattern |
| **RTL (`margin-left/right`, `left:/right:`, logical properties)** | — | **none** | — | zero detection |
| **390px mobile stacking / `min-width` overflow / per-breakpoint matrix** | — | **none** | — | only `@media` presence |
| **Real dark-mode (`prefers-color-scheme`/`[data-theme]` blocks)** | — | **none** | — | only raw-hex proxy |
| **Themed `<a>` button hover/focus/visited/active states** | — | **none** | — | stated portfolio pain point, unchecked |

## F. i18n / lifecycle / seam

| Surface | Module | Depth | Reach | Key blind spot |
|---|---|---|---|---|
| i18n presence (text-domain, `languages/`, `.pot`, `load_textdomain`) | code-quality-checker | partial | tool | presence only — **no domain-mismatch check** (`__('x','wrong-domain')`), no translator-comment check |
| readme Stable tag == header Version, tested-up-to freshness | marketing-evaluator | full | tool | — |
| Lifecycle (activation/deactivation/uninstall present + guarded) | plugin-dev-rules, db-checker, gap-analyzer | full | tool | — |
| **Deprecations (`_deprecated_function`, deprecated-WP-API usage)** | — | **none** | — | not detected |
| **DB schema-version drift** | — | **none** | — | not detected |
| **Autoloading (PSR-4/classmap/composer sanity)** | — | **none** | — | not checked (cf. worktree-autoload trap) |
| **Free→Pro hook/filter seam contract** | — | **none** | — | dup-checker knows override families but nothing verifies the seam |
| **Bundled SDK/runtime under `tests/bin/build/dist`** | — | **excluded** | — | `DEFAULT_EXCLUDE_DIRS` skips those dirs → bundled EDD-SDK code is never scanned |

## G. Product / market / readiness (meta)

| Surface | Module | Depth | Reach | Note |
|---|---|---|---|---|
| Category feature expectations (customer POV) | category-expectations | full | audit_plugin | 13 category defs; `multilingual`/`media` enum values are **dead** (no def); **no theme category** |
| Competitive analysis (WP.org/CodeCanyon/Google) | competitive-analyzer | full (fragile) | **orphan** | only entry point `analyze_market` is excluded; `audit_plugin` does not call it → unreachable on the default surface |
| Marketing / readme audit (11 checks) | marketing-evaluator | full | tool | — |
| Manifest rules engine (~26 conditional + 12 unconditional) | gap-analyzer | full | audit_plugin | header says "~35 rules", actual ~26 |
| Readiness "the bar" (17 items, `audit/readiness-bar.json` overridable) | readiness-checklist | full | tool | tool description advertises **PHPUnit-tests** as a bar item — no such item exists in `defineBar()` |
| Scaffolding (plan/, quality configs, CI) | plan-bootstrap, quality-scaffolder | full | tool/hidden | plan flow stubs are all TODO |
| Basecamp ledger | basecamp-learner | full | tool | reopen-detection unsupported |
| Report aggregation (A+..F, SARIF/JUnit) | report-builder | full | audit_plugin | `formatReport`, `exportJson` are **orphan exports** (never called) |

## Cross-cutting tooling gaps

1. **Silent degradation** — external-tool checks fall back to grep or skip with no signal; readiness-bar checks for config *presence*, which partly mitigates, but a passing functional run can hide an uninstalled linter.
2. **Everything is static except 4 runtime surfaces** — api-checker, role-matrix-prober (live), visual-regression (renders 4 signals), cert-runner (delegates). browser-runner generates but never executes. Nothing proves *painted* output (the "LOOK at the screenshot" blind spot).
3. **Orphans / drift** — competitive-analyzer unreachable; report-builder orphan exports; dead `multilingual`/`media` categories; source exposes `wppqa_readiness`/`_portfolio` but the live tool snapshot omits them (source↔deployed drift to confirm).
4. **No single all-surface gate** — `audit_plugin` omits competitor research and every "none" surface above; there is no one command that asserts the full portfolio bar.
5. **No theme support** — every category and most heuristics assume a plugin; themes have no category, no theme-specific checks.
