# wp-plugin-qa CI templates

Drop-in GitHub Actions workflow that runs the `wp-plugin-qa-mcp-server` systemic
checkers on every PR and push to `main` / `master`.

## What each check catches

| Check | What it catches | Fails build on |
|---|---|---|
| `wppqa_check_wiring_completeness` | Settings saved to DB (admin form + handler + model + REST) but never read by any template. The "toggle does nothing" class of bug. | `error` issues |
| `wppqa_check_ux_guidelines` | Raw hex/px outside `var(--{prefix}-*, fallback)`, Dashicons, emoji in UI labels, `outline: none` without `:focus-visible`, missing `.{prefix}-page-header` on edit screens. Auto-detects the CSS prefix from your `--{prefix}-*` variables. | `error` only (warnings pass) |
| `wppqa_check_plugin_dev_rules` | `alert()` / `confirm()` in JS, nonce check without matching `current_user_can`, activation hooks nested inside classes, `uninstall.php` missing `WP_UNINSTALL_PLUGIN` guard, raw `-1` in number inputs, inline `onclick`, tap targets `<40px`, 3-breakpoint discipline. | `error` issues |
| `wppqa_check_visual_regression` (not in CI — local only) | Admin edit screens that ship with `<table class="form-table">` instead of the plugin's `.{prefix}-admin-card` wrapper. Needs a running WP site + Playwright. | Run locally — see below |

## How to add the workflow to a plugin

```bash
cd /path/to/your-plugin
mkdir -p .github/workflows
curl -sSL \
  https://raw.githubusercontent.com/vapvarun/wp-plugin-qa-mcp-server/master/ci-templates/github-actions-wppqa.yml \
  > .github/workflows/wppqa.yml
git add .github/workflows/wppqa.yml
git commit -m "ci: add wp-plugin-qa systemic checks"
```

No secrets, tokens, or Local-by-Flywheel setup required. All three checks are
pure static analysis — they read files, do regex + DOM-shape scans, and return
a JSON report. Each runs in under 2 seconds on a typical plugin.

## How to interpret the output

Every check emits both a human-readable summary to the job log AND a JSON file
uploaded as the `wppqa-reports` artifact. The JSON shape:

```json
{
  "category": "wiring" | "ux-guidelines" | "plugin-dev-rules",
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "type":     "error"    | "warning" | "info",
      "title": "short description",
      "message": "longer explanation",
      "file": "includes/admin/views/quiz-editor.php",
      "line": 142,
      "code": "half-wired-setting",
      "fix": "optional suggested remediation"
    }
  ],
  "passed": 4, "failed": 1, "skipped": 0, "duration": 312
}
```

- **`type: "error"`** fails the build.
- **`type: "warning"`** is surfaced in the log but does not fail.
- **`type: "info"`** is informational (e.g. "Playwright not installed — skipping").

Download the `wppqa-reports` artifact from the failed run to see the full list
of issues when the log is truncated.

## How to suppress false positives (`.wppqa.yml`)

Place a `.wppqa.yml` at the plugin root:

```yaml
# .wppqa.yml — per-plugin wppqa configuration
wiring:
  # Keys that look half-wired but are read via a runtime filter we can't trace.
  # Suppresses the half-wired-setting issue for these keys only.
  ignore_keys:
    - content_type
    - legacy_grading_method

ux-guidelines:
  # Files allowed to use raw px (e.g. shadow offsets, borders).
  allow_raw_px_in:
    - assets/css/editor-overrides.css
  # CSS prefix override if auto-detection picks the wrong one.
  prefix: lrn

plugin-dev-rules:
  # Skip the alert/confirm ban inside Storybook or test harnesses.
  exclude_files:
    - tests/**
    - storybook/**
```

Respected by the checkers when present. If `.wppqa.yml` is absent, all rules
run at defaults.

## Running the visual-regression check locally

This check needs a live WordPress site and Playwright; it is deliberately NOT
wired into the CI workflow. From a Local-by-Flywheel site root:

```bash
# Install Playwright once
npx -y playwright@latest install chromium

# Run against Learnomy
node -e "
import('/tmp/wppqa/build/visual-regression-checker.js').then(({ checkVisualRegression }) => {
  const r = checkVisualRegression({
    pluginPath: '/absolute/path/to/learnomy',
    siteUrl: 'http://lms.local',
    autologinParam: '?autologin=1'
  });
  console.log(JSON.stringify(r, null, 2));
});
"
```

Screenshots land in `{plugin}/.wppqa-out/visual/{slug}.png`. Issues with code
`visual-design-deviation` identify admin edit screens missing the design-system
wrapper.

Prereqs:
- A WP site running locally with the `dev-auto-login` mu-plugin installed (so
  `http://site.local/?autologin=1` logs in as admin).
- Playwright installed either in the plugin directory or globally.
- The plugin has a declared CSS prefix (e.g. `--lrn-*`, `--bx-*`). If the
  auto-detection picks the wrong prefix, override it in `.wppqa.yml`.

## Graceful degradation

If a prerequisite is missing, each check returns a `skipped: 1` result with an
info-level issue explaining what's needed. They never crash the audit. In CI:

- Playwright missing → the visual-regression check (if you wire it in) emits
  `visual-regression-skipped-no-playwright` and exits 0.
- `site_url` missing → emits `visual-regression-skipped-no-site` and exits 0.
- No `add_submenu_page` / `add_menu_page` discovered → emits
  `visual-regression-skipped-no-urls`. Pass an explicit `admin_urls` list to
  force the probe.
