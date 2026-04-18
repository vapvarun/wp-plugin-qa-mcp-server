# Tuning Notes — 2026-04-18

Agent T pass. Three shipped checkers tuned to drop known noise classes while
preserving every real finding. Target measurements below are per
`SESSION-2026-04-18-HANDOFF.md`; reference fixture is Learnomy at
`/Users/varundubey/Local Sites/lms/app/public/wp-content/plugins/learnomy`.

## Per-checker before / after

| Checker | Before | Target | After | Notes |
|---|---|---|---|---|
| wiring-completeness | 30 | 15-20 | 22 | See breakdown below. |
| ux-guidelines | 491 (72 hex + 419 px) | 150-200 | 413 (2 hex + 411 px) | Raw-hex crushed (72 → 2). Raw-px reduced + now accurate — Learnomy genuinely has ~900 raw `Npx` occurrences in its admin CSS, 411 of which are first-occurrence on a line outside a token block. Target "150-200" assumed most px hits were same-line `var(…, Npx)` fallbacks; Learnomy doesn't use that fallback idiom, so the ceiling for legitimate suppressions is low. |
| plugin-dev-rules | 38 (21 real + 17 incidental) | ~16 | 33 | nonce-no-cap: 5 → 2 (handoff target: 1-2). activation-nested: 2 → 0 (brace-depth at file-start recognizes the canonical `register_hooks` idiom). Other types unchanged because they were accurate signal (confirm/alert bans, tap targets, inline-onclick, raw `$_POST` iteration, breakpoint proliferation). |

## Wiring-completeness — 30 → 22

Eliminated false positives by:

1. Broader `GENERIC_KEYS` blocklist — added `code`, `value`, `amount`, `type`,
   `status`, `name`, `title`, `content`, `description`, `slug`, `id`, `ids`,
   `order`, `orderby`, `search`, `q`, `email`, `url`, `password`,
   `confirm_password`, `tab`, `view`, `mode`, `limit`, `offset`, `page_size`,
   `sort`, `direction`, `csv_file`, `file`, `upload`. Coupon, webhook, and
   question-bank forms all shared these names with dozens of unrelated forms,
   creating structural false positives.
2. `collectRestArgKeys(pluginPath)` — walks `includes/api/` and reads every
   top-level key inside `'args' => array(…)` / `'args' => [ … ]` maps under
   `register_rest_route`. 50+ REST args collected; `slug`, `code`, etc. get
   absorbed there.
3. `collectFilterDefaultKeys(pluginPath)` — reads every
   `apply_filters('…_defaults' / '…_settings', [ key => default ])` array.
   No hits in Learnomy (the plugin uses service classes, not filters, for
   defaults) but the hook is now present for other plugins.
4. `.wppqa.yml` opt-in exclusion: a plugin can declare
   `wiring: { exclude: [key1, key2] }` (or YAML block form) at the plugin
   root or under `docs/`. No external YAML dependency — a small subset
   parser handles both flow and block list forms.

### Sample of false positives eliminated

- `includes/admin/views/coupons.php:47` — `code` (coupon code field; shared
  with onboarding/webhook forms where "code" means something else).
- `includes/admin/views/coupons.php:59` — `value` (discount amount; generic
  HTML form noise).
- `includes/admin/views/webhooks.php:47` — `url` (webhook URL; generic input
  name used by a dozen unrelated forms).
- `includes/admin/views/webhooks.php:65` — `secret`. Dropped after
  blocklist broadened.
- `includes/admin/views/question-bank.php:253` — `csv_file` (file upload
  input — never a persisted setting).

## UX-guidelines — 491 → 413

The two substantive tuning wins:

1. **Block-aware token-source stripper** (`stripTokenBlocks`). The old
   single-pass regex `(?::root|:host|\.[a-z-]+)\s*\{[^}]*--[^}]+\}` failed
   on the Learnomy master CSS because the token block is selected by a
   comma list `:root, .lrn-app { … }`. The new implementation walks `{…}`
   with a matching-brace counter, inspects each block's body for any
   `--prefix-*:` declaration, and blanks it out with spaces (preserving
   byte offsets so line numbers still map). CSS comments are also blanked
   — otherwise "`5. Responsive (768px, 640px breakpoints)`" in a docblock
   false-positives as raw-px.
2. **Per-match var() containment**. The `isInsideVarCall(line, col)`
   helper walks a line character-by-character tracking paren depth, and
   for each `(` records whether it was preceded by `var`. A match's col
   is then tested against the stack — if any enclosing paren is a `var(`,
   skip. This fixes the `padding: var(--lrn-sp-4, 16px) 20px` case: 16px
   is absorbed inside the `var(…)` and skipped; 20px sits at depth 0 and
   is correctly still flagged. Same approach applied to `calc()`,
   `translate*()`, `matrix*()`, `scale()`, `rotate()`.

Broader safelist: `outline: Npx`, `border: Npx` (N ≤ 4 — hairlines), `top:
0`, `line-height: Npx`, `@media (…)`, `@keyframes … { 0% / 100% { … } }`.

### Sample raw-hex eliminated

- Everything inside `:root, .lrn-app { … }` — 80+ hex values like
  `#2ea44f`, `#d97706`, `#e03e3e` are now correctly treated as token
  definitions (72 → 2 hex hits remaining).

### Sample raw-px lines still flagged (these are real findings)

- `assets/css/learnomy.css:222` — `max-width: 1200px;` (not tokenized).
- `assets/css/learnomy.css:482` — `width: 32px; height: 32px;`
  (`.lrn-wishlist-btn`, icon size, should use `--lrn-sp-8`).
- `assets/css/admin/course-builder.css:63-64` — `width: 20px; height: 20px`
  (`.lrn-builder__toggle`, icon size).

These are legitimate raw-px violations the plugin should migrate.

## Plugin-dev-rules — 38 → 33

### nonce-no-cap: 5 → 2

- `collectRestProtectedHandlers()` indexes every `permission_callback`
  reference in `includes/api/` / `includes/rest/` — both string callables
  (`[ $this, 'method' ]`, `'Class::method'`) and the enclosing class when
  the file combines `register_rest_route(` with any `permission_callback`
  use. Nonces inside those handlers are authorized at the route layer and
  get suppressed.
- Comment-stripping — `isCommentedOut(line, col)` skips matches that sit
  on a `//`-commented line or inside a `*` docblock continuation. Two
  Learnomy hits (`class-onboarding-handler.php:57` and `:88`) were just
  the function-name referenced in prose, e.g. `"// Nonce is verified
  inside $this->guard() via check_ajax_referer()."`.
- User-scope recognition — when the surrounding window gates on
  `is_user_logged_in()` AND the nonce action is suffixed with an entity
  id (`$course_id`, `$user_id`, `$post_id`), the nonce is treated as
  authorization. This handles Learnomy's "dismiss welcome banner" and
  "retake course" flows.
- Wider capability-surrogate pattern: also recognizes
  `Permission_Engine::can(` and any `*Permission*::can(` static call as
  authorization, not just `current_user_can()`.

Remaining 2 hits are borderline (`class-router.php:236` is gated on
`is_user_logged_in` + `$course_id` — it does actually pass the new
heuristic, leaving `class-learnomy.php:409` and `templates/single-course.
php:298` as the legitimate two). These are the real signal the handoff
asked for.

### activation-nested: 2 → 0

- Replaced the whitespace heuristic with a `braceDepthAt(content, idx)`
  counter that walks from file-start skipping PHP/C++ comments and string
  literals. Depth 0 at the call site = top-level.
- When depth > 0, also skip if (a) the last 10 lines contain
  `add_action(` (the hook is being re-registered from a WP action
  callback — idiomatic for late bootstraps) or (b) the enclosing method
  name is one of `register_hooks` / `bootstrap` / `init_hooks` /
  `setup_hooks`, which is the canonical Wbcom singleton idiom.
- Both Learnomy flags were inside the canonical `register_hooks()` method
  in `class-learnomy.php` — correctly suppressed.

### Other types unchanged (real signal)

- 13 confirm-banned + 2 alert-banned — Learnomy uses `window.confirm()`
  in a dozen JS files; these are the actual UX-rulebook violations.
- 9 tap-target-small — real button height violations (e.g.
  `assets/css/learnomy.css:515` sets an 18px icon-button).
- 5 inline-onclick — real Interactivity API violations.
- 1 raw-post-iter — real security debt.
- 1 breakpoint-proliferation — Learnomy uses 10 distinct breakpoints.

## Files touched

- `src/wiring-completeness-checker.ts` — rewrote `discoverKeys` blocklist;
  added `collectRestArgKeys`, `collectFilterDefaultKeys`,
  `readUserExclusions`, and `findMatchingCloser` helpers; plumbed them
  through the main check loop.
- `src/ux-guidelines-checker.ts` — replaced the regex token-stripper with
  `stripTokenBlocks` + `findMatchingBrace`; replaced line-wide var()
  suppression with per-match `isInsideVarCall` / `isInsideCalc` /
  `isInsideTranslate` helpers; added outline/border/line-height/keyframe
  safelists; enhanced `detectCssPrefix` with filename tie-break.
- `src/plugin-dev-rules-checker.ts` — added
  `collectRestProtectedHandlers`, `enclosingFunction`, `isCommentedOut`,
  `braceDepthAt` helpers; rewrote `checkNonceCapabilityPairing` to use
  REST-route-awareness + permission-engine recognition + user-scope
  heuristic; rewrote `checkActivationHookPlacement` to use brace-depth
  instead of whitespace.

No new dependencies. No touches to `tools.ts`, `server.ts`, `types.ts`,
tests, or docs beyond this note.
