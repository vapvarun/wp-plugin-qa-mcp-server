# WBcom plugin portfolio — wp-plugin-qa CI rollout

Tracking which plugins / themes have the systemic-misalignment CI workflow integrated.

Each row records:
- **Repo** — GitHub URL or local path
- **Workflow** — whether `.github/workflows/wppqa.yml` is present
- **Baseline** — issue counts from the first run (used to decide whether to fail or warn-only while the baseline is paid down)
- **Notes** — any prefix override, suppression, or sequencing caveats

## Plugins + themes

| Product | Type | Repo | Workflow | Baseline (wiring / ux / plugin-dev) | Notes |
|---|---|---|---|---|---|
| Learnomy (Free) | plugin | internal — Local LMS | not yet | 30 / 491 / 21 | Reference plugin — the 3 checkers were calibrated against this codebase. Visual-regression tested against `http://lms.local`. |
| Learnomy Pro | plugin | internal | not yet | unknown | Pro modules inherit Free prefix `--lrn-*`. Test with same `http://lms.local` site. |
| BuddyX | theme | https://github.com/wbcomdesigns/buddyx | not yet | unknown | Theme not plugin — the checkers work but CSS prefix is `--bx-*`. Wire after Learnomy proves out. |
| BuddyX Pro | theme | internal repo | not yet | unknown | Same prefix as BuddyX (`--bx-*` / `--bxpro-*`). |
| BuddyPress Hashtags | plugin | https://github.com/wbcomdesigns/buddypress-hashtags | not yet | unknown | Smaller surface — likely clean baseline. |
| BuddyPress Polls | plugin | https://github.com/wbcomdesigns/buddypress-polls | not yet | unknown | Admin settings page is the main UX surface to audit. |
| BuddyPress Moderation Pro | plugin | internal repo | not yet | unknown | Uses wbcom-admin-wrapper legacy pattern — expect tab-based admin UI, confirm prefix auto-detects. |
| BuddyPress Member Blog | plugin | https://github.com/wbcomdesigns/buddypress-member-blog | not yet | unknown | Frontend-heavy; wiring checker will have less to say, UX guidelines more. |
| Product Roadmap | plugin | internal | not yet | unknown | Prefix `--prdm-*`. Roadmap item editor is the primary visual-regression target. |
| Jetonomy | plugin | internal | not yet | unknown | Brand-new codebase — wire in from day 1 so baseline stays at 0. |

## Integration sequencing

1. **Learnomy Free** — wire `.github/workflows/wppqa.yml` as warn-only (comment out `process.exit(errs > 0 ? 1 : 0)`). Capture baseline.
2. **Close the baseline** — fix all `error`-level issues on Learnomy. Flip warn-only to fail-build.
3. **Fan-out** — copy the workflow to BuddyPress Hashtags, Polls, Member Blog in parallel. Those are small surfaces; baselines should be low.
4. **BuddyX + BuddyX Pro** — themes; confirm the auto-detected prefix is `bx` / `bxpro` not `lrn`. Add `.wppqa.yml` override if needed.
5. **Moderation Pro + Product Roadmap** — wire after flow is smooth.
6. **Jetonomy** — wire from the first commit; never accept a baseline >0.

## Visual-regression rollout (not CI)

The visual-regression check needs a running WP site, so it runs on demand from
a developer laptop. Usage:

```bash
# From any Local-by-Flywheel site
node -e "
import('/tmp/wppqa/build/visual-regression-checker.js').then(async ({ checkVisualRegression }) => {
  const r = checkVisualRegression({
    pluginPath: '/absolute/path/to/plugin',
    siteUrl: 'http://site.local'
  });
  console.log(JSON.stringify(r, null, 2));
});
"
```

Expected mapping of plugin → local site URL:

| Plugin | Local site |
|---|---|
| Learnomy | `http://lms.local` |
| BuddyX / BuddyX Pro | `http://buddypress-dev.local` |
| BuddyPress Hashtags / Polls / Member Blog / Moderation Pro | `http://buddypress-dev.local` |
| Product Roadmap | `http://roadmap.local` |
| Jetonomy | tbd |

Screenshots are written to `{plugin}/.wppqa-out/visual/{slug}.png`. Review them
against the plugin's design-system reference screen (usually the Course
editor for Learnomy, the first settings page for others) before accepting the
baseline.

## Rollout status legend

- **not yet** — workflow file not in repo
- **warn-only** — workflow present, `errs > 0 ? 1 : 0` commented out
- **enforcing** — workflow present, fails build on errors
- **N/A** — product has no admin surface worth auditing (rare)
