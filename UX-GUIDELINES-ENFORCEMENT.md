# `wppqa_check_ux_guidelines` — Check Spec

Drafted 2026-04-18 as the 6th new check (companion to the 5 in `LEARNOMY-LESSONS-LEARNED.md`). This one turns a plugin's UX-guidelines doc into machine-checkable rules so grep + Playwright can catch violations automatically.

## Why this check exists

Sprint lesson: Learnomy's `docs/UX-GUIDELINES.md` is 1241 lines of well-written rules. **Not one of those rules is automatically enforced.** Every new view that ships can violate any rule and no gate catches it. Result: Quiz + Question editors shipped with `table.form-table` while the doc clearly specifies `.lrn-admin-card + .lrn-settings-section` pattern. Caught manually 3 days later by a Playwright screenshot.

Every WordPress plugin with a non-trivial UI has this same gap.

## How the check works

1. **Discover the guidelines doc.** Default: `docs/UX-GUIDELINES.md`, `docs/UX.md`, or configurable path.
2. **Parse the doc into rules** — 3 rule kinds:
   - **Token rules** — "use `--xxx-*` CSS custom properties"
   - **Component rules** — "every form is wrapped in `.xxx-admin-card`"
   - **Prohibition rules** — "no Dashicons", "no emoji", "no gradients"
3. **Run the rules against the plugin** — grep for violations in CSS/PHP/JS, Playwright-screenshot verification for layout rules.
4. **Report per-file violations** with expected vs found.

## The 10 rule families the check should enforce

These are generic to any token-based, component-first WordPress plugin. Learnomy is the reference but the same rules apply to BuddyX, BuddyNext, Jetonomy, etc.

### 1. CSS token compliance

**Rule:** Every color, spacing, radius, font-size value lives inside `var(--{prefix}-*, fallback)`. No raw hex, no raw px, no raw font-family, no raw `rgb()`.

**Check:**
```
grep -rE '([^(\-])#[0-9a-fA-F]{3,8}' assets/css/
grep -rE '([^\-0])[0-9]+px[^)]' assets/css/   # px outside var() fallback
grep -rE 'font-family: *[^v]' assets/css/      # font-family not using var()
```

**Pass condition:** all hex/px/font values appear inside `var(--lrn-*, fallback)` pattern only. Values inside the `:root` declaration block are exempt (that's the token source).

### 2. Design system component usage

**Rule:** Every admin edit screen wraps its content in the plugin's established card component (`.lrn-admin-card`, etc.) and accordion component (`.lrn-settings-section` or equivalent).

**Check:** For every `render_*` method in admin class that outputs a form, Playwright-load the URL + assert the DOM contains at least one element with the plugin's card selector. Flag views that use `<table class="form-table">` without a card wrapper.

**Bonus:** compare to a reference screen (e.g., the first editor that was built to spec). If the new screen doesn't use the same wrapper structure, flag.

### 3. Icon policy

**Rule:** Lucide SVG only. No Dashicons. No emoji in UI labels.

**Check:**
```
grep -rE 'dashicons-' assets/ includes/ templates/
# Emoji detection — unicode classes:
grep -rP '[\x{1F300}-\x{1F6FF}\x{2600}-\x{26FF}]' assets/ includes/ templates/
```

**Known exceptions:** root admin menu icon (WordPress requires a Dashicon there), code comments (not user-facing).

### 4. Progressive disclosure

**Rule:** Long forms use collapsible sections. Don't show all 18 settings at once when 4 are primary and 14 are advanced.

**Check:** Playwright-load each edit screen. Count visible input elements above the fold (top 900px). If ≥ 12 inputs visible at once, flag as "no progressive disclosure."

### 5. Inline help, not tooltips

**Rule:** Every non-obvious field has a `.xxx-form-help` (or equivalent) element under it with a one-sentence explanation. No hover tooltips for critical info.

**Check:** For every labeled input in every admin view, grep the PHP for a following `.lrn-form-help` element within 10 lines. Flag inputs with non-obvious names (anything not `title`/`slug`/`name`) that have no help text.

### 6. Human labels, not jargon

**Rule:** Labels say "Which attempt counts", not "grading_method". No column names as visible text.

**Check:** Grep for `<label[^>]*>\w+_\w+<` (labels containing underscore-joined words, which usually means raw column names). Flag as probable jargon.

**Pass condition:** Every label visible to users reads as an English phrase.

### 7. Grid + spacing consistency

**Rule:** 4px grid. All margins/padding use spacing tokens (`--lrn-sp-1` through `--lrn-sp-16`). No custom `24px` or `37px` values.

**Check:**
```
grep -rE 'margin|padding' assets/css/ | grep -vE 'var\(--lrn-sp|0[;\s]|auto|inherit'
```

Flag any hardcoded non-token values.

### 8. Empty states

**Rule:** Every list view + dashboard widget that can be empty has an `.lrn-empty-state` with illustration + helpful message + primary CTA.

**Check:** For every `render_` method that produces a table or list, seed the DB with zero rows (or filter to a no-match query), Playwright-load the page, assert an element with class matching `empty-state` exists. Flag views that render an empty table shell with no empty state.

**Learnomy example it would have caught:** the instructor dashboard Completion Funnel renders 4 bars with sliver fills at zero data (not an empty state, just broken-looking).

### 9. Keyboard + focus-visible

**Rule:** Every interactive element shows a focus ring that's at least 2px and uses `--lrn-accent`.

**Check:**
- Grep CSS for `outline: none` — flag without a matching `:focus-visible` rule nearby.
- Playwright: tab through each admin edit screen, screenshot the focus state every 3 tabs, check that focus is visible.

### 10. Page header consistency

**Rule:** Every admin screen has `.lrn-page-header` with h1 + optional breadcrumb + primary action button in the top-right.

**Check:** For every admin view, Playwright-load and query for `.lrn-page-header`. Flag any view that uses a raw `<h1>` without the wrapper.

## Configuration

Tool input:
```
{
  plugin_path: "/path/to/plugin",
  guidelines_doc: "docs/UX-GUIDELINES.md",  // optional, auto-detected
  prefix: "lrn",                             // CSS/class prefix
  admin_url_base: "http://localhost/wp-admin/admin.php?page=",
  screens_to_audit: [
    "learnomy-edit-course",
    "learnomy-edit-quiz",
    "learnomy-question-editor",
    "learnomy-lesson-editor"
  ],
  autologin_url: "http://localhost/?autologin=1"  // optional
}
```

## Output shape

Per-rule, per-file, per-line output. Screenshots attached when layout rules fail.

```
RULE: icon_policy (Dashicons prohibited)
  VIOLATION: 3 occurrences
    - includes/admin/views/earnings.php:245 — `class="dashicons dashicons-calendar"`
    - includes/admin/views/student-dashboard.php:89 — `class="dashicons dashicons-book"`
    - assets/js/dashboard.js:12 — `dashicons-admin-tools`
  SEVERITY: error

RULE: component_card_wrap
  VIOLATION: 2 screens
    - learnomy-edit-quiz — page has no .lrn-admin-card wrapper
      screenshot: /out/screens/edit-quiz.png
    - learnomy-question-editor — uses <table class="form-table"> instead
      screenshot: /out/screens/question-editor.png
  SEVERITY: error

RULE: empty_state_present
  VIOLATION: 1 view
    - Dashboard → Completion Funnel widget renders with 0-value bars
      screenshot: /out/screens/dashboard-empty.png
  SEVERITY: warning
```

## Integration with `wppqa_audit_plugin`

This check runs as part of the new `wppqa_check_systemic_misalignment` bundle (alongside the 5 from `LEARNOMY-LESSONS-LEARNED.md`).

Verdict gate: any `RULE: ... SEVERITY: error` fails the audit. Warnings are reported but don't block.

## Implementation priority

High — tied with `wppqa_check_wiring_completeness`. Both are "systemic miss" classes that exist in most plugins silently.

Estimated effort: **3 days** for the 10 rule families + reference-screen comparison. Playwright-driven rules are ~60% of the work.

## Reference fixtures

Learnomy screenshots at `.playwright-mcp/visual-audit/` are the test fixtures:
- `00-reference-course-form.png` — the reference "passes every rule"
- `question-editor-current.png` — violates card wrap, progressive disclosure, cramped field rows
- `lesson-editor-1195.png` — violates layout bias (sidebar overloaded)

These become the test cases during implementation — the tool should correctly flag violations on the bad screens + pass on the reference.

## Related files in the guidelines

`UX-GUIDELINES.md` sections mapped to rules:
- §1 Design Foundation → Rules 1, 3, 7
- §2 Component Library → Rules 2, 10
- §3 Course Builder → Rules 4, 5, 6
- §5 Dashboards → Rule 8
- §7 Flows & Micro-interactions → Rule 9

## What this does NOT check

- Business logic correctness (that's `wppqa_check_wiring_completeness`)
- DB / migration hygiene (that's `wppqa_check_database`)
- Code quality (that's `wppqa_check_code_quality`)
- Responsive breakpoints below 390px (separate future check)
- Motion + animation timing (separate, low priority)

## Adoption plan

1. Implement against Learnomy's guidelines doc as the reference.
2. Generalize by making all prefix constants (`--lrn-*`, `.lrn-*`) configurable.
3. Test against BuddyX theme + BuddyPress Hashtags + Jetonomy — all 3 have UX guidelines docs that currently aren't enforced.
4. Add to every plugin's CI as a blocking gate before merge.
