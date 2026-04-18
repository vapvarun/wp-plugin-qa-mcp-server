# wp-plugin-qa MCP — New Checks from Learnomy v1.3.0 Sprint

Drafted 2026-04-18 based on the content-completeness + wiring-complete sprints. Every failure class below was caught manually; most exist in other WordPress plugins but no automated check surfaces them. These checks should be added to `wppqa_audit_plugin` or broken out into new dedicated tools.

## The 5 classes of bugs the sprint taught us

### 1. Half-wired settings — "saves but doesn't affect"

**Pattern:** Admin form writes a setting to DB (column or `settings_json`). Backend models + REST accept it correctly. But the student-facing template never reads it. Instructor toggles the flag, sees nothing change, files a bug.

**Learnomy example:** 24 of 43 fields in this state before the wiring sprint (`reviews_enabled`, `is_private`, `is_featured`, `allow_retake`, `completion_message`, 12 others). Every single one had a working admin form + handler + REST endpoint + DB column.

**Why every plugin has this:** WordPress plugins historically grow admin forms feature-by-feature. A new option gets added to the form + the handler + the settings page screenshot, ships, users adopt it, but the template that actually needs to read the setting is in a separate file the PR didn't touch. Especially bad for "toggle" settings where the absence of a side effect is silent.

**Automated check proposal — `wppqa_check_wiring_completeness`:**

For every column on every custom table + every key written to `settings_json`-style blobs:
1. Grep the templates/views directory for any reference to the column name.
2. Grep for the model getter that would read it (`$model->column`, `get_setting('key')`).
3. If the admin form POSTs it but no template reads it → flag as HALF-WIRED.
4. For each half-wired field, list the admin form file:line + the expected template surface.

Bonus: run a toggle test — create a fixture course, flip the setting, reload the public page, diff the HTML. If diff is empty, the setting is truly dead. If diff is non-empty but admin form also didn't render the setting visibly (different issue), flag separately.

### 2. Enum drift — admin / REST / service / DB all speak different dialects

**Pattern:** One ENUM-shaped value (`question type`, `grading method`, `feedback timing`) is hardcoded as a list in 4-5 places and they don't match.

**Learnomy examples caught:**
- Admin wrote `grading_method=last` but `Quiz_Service` read `latest` → never matched, students saw wrong scores.
- Question type `multiple_choice` (REST) vs `mc_single` (admin) — REST calls never found the rows the admin showed.
- `feedback_timing` admin offered 3 values, REST whitelist offered 5, service implemented 2. 3 of 5 were dead.
- Lesson `content_type` Pro used `download` where Free used `pdf` — Pro drafts saved with Free invalid.

**Automated check proposal — `wppqa_check_enum_consistency`:**

1. Find every `in_array`, `switch` on strings, `'enum' => [...]` array in the plugin.
2. Group by the variable name being compared (`$type`, `$mode`, `$status`, `$grading_method`, etc.).
3. Flag any group where the sets of allowed values differ across files.
4. Bonus: check the actual DB data — `SELECT DISTINCT <column> FROM <table>` — if rows exist with values not in any allowed list, flag as orphan data (`multiple_choice` rows that should have been `mc_single`).

### 3. REST envelope mismatch — JS reads `data.courses`, PHP emits `data.list`

**Pattern:** Frontend JavaScript expects a response shape that was legacy from an earlier controller version. Controller was refactored to a cleaner envelope. Both tests in isolation pass but the live integration silently breaks.

**Learnomy example:** `catalog-view.js` expected `{courses: [], next_cursor: ...}` but `Base_Controller` returned `{data: [], meta: {cursor_next: ...}}`. Catalog filters looked broken — they actually fetched fine but the JS couldn't unpack the response.

**Automated check proposal — `wppqa_check_rest_js_contract`:**

1. For each registered REST route, issue a real request and capture response shape.
2. Grep JS for the route URL. Within a reasonable context window (50 lines), look for property accesses on the response (`data.courses`, `res.next_cursor`).
3. Flag any access to a property that doesn't exist in the actual response.

### 4. Layout bias — sidebar cramped, content wasted

**Pattern:** Admin editor uses Gutenberg-style narrow-content + tight sidebar. Fine for posts/pages (body is the content). Catastrophic for plugins where metadata IS the authoring work (LMS lesson has 6 critical cards while the content body is often empty).

**Learnomy example:** Lesson editor had 6 cards squeezed into a 280px sidebar (Publish, Placement, Settings, Completion Rules, Resources, Release) while the main area had only Title + empty Content.

**Automated check proposal — `wppqa_check_editor_layout_bias`:**

1. For each editor view file, count:
   - Number of admin cards/meta-boxes in the sidebar vs main area
   - Total inputs in sidebar vs main
   - Viewport utilization (browser automation: load page, measure filled vs empty area)
2. Flag editors where:
   - Sidebar has ≥4 cards AND main area has <3 inputs (inverted priority)
   - Viewport is >50% empty
   - Average input row width in sidebar is <250px (cramped)

### 5. Silent visual-regression — `grep` passes but Playwright reveals it

**Pattern:** Design system has `.lrn-admin-card` + `.lrn-settings-section`. Newer editor uses WP-default `.form-table`. Grep for `class=` shows the design tokens are present in OTHER files; current file has no tokens but also has no Dashicons. So `grep` tools say "compliant". Actual browser render shows the editor is styled as a 2015 WP settings page.

**Learnomy example:** Quiz + Question editors (Wave 2) shipped with correct backend wiring but visually used WP `.form-table` while the Course editor used the accordion pattern. My text-only audit approved them; Playwright screenshots caught it in 5 minutes.

**Automated check proposal — `wppqa_check_visual_regression`:**

1. Take Playwright screenshots of every admin edit screen at 1440x900.
2. For each screen, check: does it use the plugin's established "card" wrapper class? (Grep the screen's rendered DOM, not just the source file.)
3. If the plugin has a reference screen (defined in a config), compare visual similarity of the new screen's layout — same vertical rhythm? same margin pattern?
4. Flag outliers where a screen's style differs from the plugin's established pattern.

Minimum viable version: just enumerate every admin edit screen, screenshot it, ask the auditor to skim and flag visual outliers.

## Meta-lesson — the audit gate

My audit-quality lesson: **grep + DB probes ≠ done.** Every UX-adjacent sprint needs a final Playwright visual pass. Without it, you get "APPROVED" verdicts that hide real bugs.

Proposal: add to `wppqa_audit_plugin` a new required stage `wppqa_visual_audit_required` that refuses to return APPROVED if no Playwright screenshots are on file for the touched admin/frontend surfaces.

## Implementation priority

1. **`wppqa_check_wiring_completeness`** (highest value — most plugins have this class silently) — est 2 days
2. **`wppqa_check_enum_consistency`** — est 1.5 days
3. **`wppqa_check_visual_regression`** — est 2 days (Playwright integration)
4. **`wppqa_check_rest_js_contract`** — est 1 day
5. **`wppqa_check_editor_layout_bias`** — est 1 day

Add a top-level `wppqa_check_systemic_misalignment` that bundles 1–4 and runs them as one gate.

## Concrete artefacts from Learnomy

- `docs/VERDICT-wiring-final.md` — the table format to use for output (one row per field × layer with ✓/✗ marks).
- `docs/VERDICT-full-visual-audit.md` — screenshot-grouped output pattern for the visual regression check.
- `.playwright-mcp/visual-audit/` — 26 reference screenshots + named violations.

These 3 files become the test fixtures for developing the new checks.

---

## Update 2026-04-18 — 6th check added: UX guidelines enforcement

Separate spec at `UX-GUIDELINES-ENFORCEMENT.md`. Runs the plugin's own docs/UX-GUIDELINES.md (or equivalent) as machine-checkable rules. Covers:

1. CSS token compliance (no raw hex/px/font outside `var(--xxx-*, fallback)`)
2. Design-system component usage (card + accordion wrapper required)
3. Icon policy (Lucide only, no Dashicons, no emoji)
4. Progressive disclosure (fail if ≥12 inputs visible above fold)
5. Inline help vs tooltips
6. Human labels (no column-name-as-label)
7. Grid + spacing consistency (4px grid, token-based margins/padding)
8. Empty states (every list view has `.empty-state`)
9. Keyboard + focus-visible
10. Page header consistency

Fixtures: Learnomy's `visual-audit/` screenshots — `00-reference-course-form.png` passes all 10 rules; `question-editor-current.png` + `lesson-editor-1195.png` violate specific rules and become the test cases.

Revised priority (still top 2):
1. `wppqa_check_wiring_completeness` — 2d
2. `wppqa_check_ux_guidelines` — 3d
3. `wppqa_check_enum_consistency` — 1.5d
4. `wppqa_check_visual_regression` — 2d
5. `wppqa_check_rest_js_contract` — 1d
6. `wppqa_check_editor_layout_bias` — 1d

Total if all six land: ~10.5 days. Bundle under `wppqa_check_systemic_misalignment` and add to every plugin's CI as a blocking gate.

