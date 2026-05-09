/**
 * WP Plugin QA MCP Server - Tool Definitions
 *
 * 27+ tools covering: discovery (plugin scanner), code quality (PHPCS,
 * PHPStan, ESLint, Stylelint, PHP Compat, a11y grep, PHP lint, Composer
 * audit, i18n, Plugin Check, bundle size, security/perf grep, PCP deep),
 * product evaluation (admin / frontend / marketing), live testing (REST,
 * DB, browser), market analysis, role-matrix probing, plan bootstrapping,
 * Basecamp learning, six systemic-misalignment checks (wiring, UX
 * guidelines, plugin-dev rules, visual regression, enum consistency,
 * REST/JS contract, editor layout bias, template contract), and the
 * journey-by-journey customer-experience audit (init / coverage check /
 * briefing / consolidate matrix).
 *
 * Tool list is the source of truth; keep it in sync with server.ts
 * switch-cases and the `wppqa_*` allow-listed names in user settings.
 */
export const tools = [
    // ─── 1. Discovery ─────────────────────────────────────────────
    {
        name: 'wppqa_scan_plugin',
        description: 'Scan a WordPress plugin directory to discover all features: CPTs, taxonomies, shortcodes, blocks, REST routes, AJAX handlers, admin pages, settings, widgets, meta boxes, cron jobs, CLI commands, DB tables, templates, hooks, and integrations. Returns structured PluginManifest JSON with cross-layer wiring analysis.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 2. Code Quality: Setup ───────────────────────────────────
    {
        name: 'wppqa_setup_quality',
        description: 'Scaffold all code quality config files in a plugin: .phpcs.xml.dist, phpstan.neon, .eslintrc.json, .eslintignore, .stylelintrc.json, .editorconfig, .pa11yci. Auto-detects text domain from plugin header, finds JS globals from wp_localize_script, adds phpstan to composer.json. Skips files that already exist.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Optional Local WP site URL for pa11y config (e.g., http://local-test.local)',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 3. Code Quality: Run All ─────────────────────────────────
    {
        name: 'wppqa_run_code_checks',
        description: 'Run ALL 14 code quality checks: PHPCS (WordPress coding standards), PHPStan (static analysis), ESLint (JavaScript), Stylelint (CSS), PHP Compatibility (7.4-8.4), a11y grep (outline:none, empty links), PHP lint (syntax), Composer audit (vulnerabilities), i18n (translations), Plugin Check PCP (WordPress.org compliance), bundle size. Returns unified report. Skips tools not installed.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 4. Code Quality: Single Check ────────────────────────────
    {
        name: 'wppqa_check_code_quality',
        description: 'Run a SINGLE code quality check by name. ' +
            'Prefer the tool-backed checks (phpcs, phpstan, eslint, stylelint, phpcompat, plugin-check, php-lint, composer-audit, i18n) — those delegate to the underlying tool. ' +
            'The grep-only scans (security-scan, performance-scan, pcp-deep, a11y-grep) are NOT authoritative: WPCS and Plugin Check cover the same patterns with data-flow awareness and produce far fewer false positives. ' +
            'Use the grep scans only when phpcs / plugin-check are not installed.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                check: {
                    type: 'string',
                    enum: ['phpcs', 'phpstan', 'eslint', 'stylelint', 'phpcompat', 'a11y-grep', 'php-lint', 'composer-audit', 'i18n', 'plugin-check', 'bundle-size', 'security-scan', 'performance-scan', 'pcp-deep'],
                    description: 'Which quality check to run. Prefer phpcs / plugin-check over the grep-only variants (security-scan, performance-scan, pcp-deep, a11y-grep).',
                },
            },
            required: ['plugin_path', 'check'],
        },
    },
    // ─── 5. Accessibility ─────────────────────────────────────────
    {
        name: 'wppqa_check_a11y',
        description: 'Full WCAG 2.1 AA accessibility audit combining static analysis and pattern grep: form labels, image alt text, ARIA usage, focus management, color contrast, keyboard navigation, screen-reader-text, outline:none detection, empty links, div-as-button, positive tabindex.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 6. Product Evaluation (merged admin+frontend+marketing) ──
    {
        name: 'wppqa_evaluate_product',
        description: 'Evaluate plugin product quality across admin UI, frontend output, and marketing readiness. Combines admin settings evaluation, frontend rendering quality, and marketing fitness scoring into one tool.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                focus: {
                    type: 'string',
                    enum: ['all', 'admin', 'frontend', 'marketing'],
                    description: 'Which area to evaluate (default: all)',
                    default: 'all',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 7. UX ────────────────────────────────────────────────────
    {
        name: 'wppqa_check_ux',
        description: 'UX and customer experience audit: help text coverage, error messages, empty states, visual feedback, settings organization, onboarding flow, consistency.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 8. Templates ─────────────────────────────────────────────
    {
        name: 'wppqa_check_templates',
        description: 'Theme override and hook analysis: template files, override paths, hooks in templates, lifecycle hooks (activation, deactivation, uninstall), filter/action placement.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 8b. Template Loader <-> Template Contract Drift ─────────
    {
        name: 'wppqa_check_template_contract',
        description: 'Cross-layer flow check: parses every `{prefix}_get_template()` / `{prefix}_get_template_html()` caller in the plugin, extracts the `args` keys each call passes, then scans the matching template file for variable reads. Flags any $var consumed in a template that no loader actually supplies in its args array. ' +
            'This catches the silent-bug class where a template quietly references a missing variable, renders an empty or warning, and nothing else detects it — WPCS, PHPStan, and Plugin Check analyze files in isolation and cannot see the loader<->template contract.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 9. API (live site) ───────────────────────────────────────
    {
        name: 'wppqa_check_api',
        description: 'Verify REST endpoints and AJAX handlers against a running Local WP site. Tests auth/unauth access, nonce validation, malformed input handling, response format. Requires Local WP running.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Local WP site URL (e.g., http://local-test.local)',
                },
            },
            required: ['plugin_path', 'site_url'],
        },
    },
    // ─── 10. Database (live site) ─────────────────────────────────
    {
        name: 'wppqa_check_database',
        description: 'Check database integrity: custom table existence and schema, settings persistence, CPT data, cleanup on uninstall, orphaned data. Requires Local WP running.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Local WP site URL',
                },
            },
            required: ['plugin_path', 'site_url'],
        },
    },
    // ─── 11. Browser (live site) ──────────────────────────────────
    {
        name: 'wppqa_check_browser',
        description: 'Generate Playwright E2E test specs based on discovered features. Creates test files for admin pages, settings, CPTs, shortcodes, blocks. Requires site_url.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Local WP site URL',
                },
            },
            required: ['plugin_path', 'site_url'],
        },
    },
    // ─── 12. Market Analysis (merged gaps + competitive) ──────────
    {
        name: 'wppqa_analyze_market',
        description: 'Analyze plugin market position: feature gaps vs market expectations, maturity scoring, competitor comparison (WordPress.org, CodeCanyon), roadmap suggestions. Combines gap analysis and competitive research.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                search_keywords: {
                    type: 'string',
                    description: 'Optional keywords for competitor search',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 13. Role-matrix REST/AJAX prober ─────────────────────────
    {
        name: 'wppqa_probe_roles',
        description: "Probe every discovered REST endpoint and AJAX action as each WordPress role (guest/subscriber/advertiser/admin by default) and report where observed HTTP status diverges from what the route's permission_callback says should happen. Catches capability/role mismatches — e.g. advertiser-portal routes accidentally gated with manage_options that would 403 in production — before release.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Base URL of the running WP site (e.g. http://wp-ads.local)',
                },
                roles: {
                    type: 'array',
                    description: 'Optional role profiles to probe. If omitted, uses the default set (guest, subscriber, advertiser, admin) assuming the wbam_dev_as dev-auto-login mu-plugin is installed.',
                    items: { type: 'object' },
                },
            },
            required: ['plugin_path', 'site_url'],
        },
    },
    // ─── 14. Write↔Read data cross-reference ──────────────────────
    {
        name: 'wppqa_cross_reference_data',
        description: 'Catalog every data store the plugin touches (post_meta, user_meta, term_meta, option, transient, custom DB tables/columns) and cross-reference writers against readers. Catches stale-read bugs where a template reads a key nothing ever writes to — the exact pattern that produces "UI always shows 0" regressions — plus stale-write keys (wasted I/O) and orphaned stores.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 15. Plan bootstrap (auto-scaffold plan/) ─────────────────
    {
        name: 'wppqa_bootstrap_plan',
        description: 'Auto-generate the full plan/ folder for a plugin that does not have one yet, derived from the live manifest so every shortcode / REST route / admin page gets a flow stub and appears in coverage.md. Skips existing files unless overwrite is set, and returns a report of created + skipped paths plus a human next-steps checklist.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                overwrite: {
                    type: 'boolean',
                    description: 'If true, regenerate every file (destructive — hand edits are lost). Default false.',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 16. Basecamp ledger (per-plugin bug history) ─────────────
    {
        name: 'wppqa_learn_from_basecamp',
        description: 'Plugin-agnostic Basecamp ledger generator with a local per-card cache. Reads plan/basecamp.yml, consumes pre-fetched data (this tool does NOT talk to Basecamp), and writes plan/basecamp/ledger.md + ledger.json + cache/columns.json + cache/cards/{id}.json so future sessions carry full bug history — fix SHAs, reopen patterns, module hot-spots, regression-fixture coverage, title-similarity duplicate detection — without re-querying Basecamp for unchanged cards. Two-phase call — first invocation with compact listings (fetched_columns) returns needsFetch; orchestrator fetches those via basecamp-mcp (basecamp_get_card + basecamp_list_comments) and re-calls with fetched_full_cards + fetched_comments populated.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the plugin directory containing plan/basecamp.yml.',
                },
                fetched_columns: {
                    type: 'object',
                    description: 'Required. Compact listings keyed by column name (matches plan/basecamp.yml keys). Each value is an array of { id, title, updated_at, created_at?, app_url?, comments_count?, assignees? }. Obtain via basecamp_list_card_ids per column.',
                },
                fetched_full_cards: {
                    type: 'object',
                    description: 'Optional. Full card bodies keyed by card id, supplied only for ids the tool reported as needsFetch.cards on a previous call (or all ids on a first run). Each value is { id, title, created_at, updated_at, content, app_url, comments_count, creator }. Obtain via basecamp_get_card.',
                },
                fetched_comments: {
                    type: 'object',
                    description: 'Optional. Comments keyed by card id, supplied only for ids the tool reported as needsFetch.comments. Each value is an array of { content, created_at?, creator? }. Obtain via basecamp_list_comments.',
                },
                project_id: {
                    type: 'string',
                    description: 'Fallback project id used only when plan/basecamp.yml is missing.',
                },
                project_url: {
                    type: 'string',
                    description: 'Fallback project url used only when plan/basecamp.yml is missing.',
                },
                force_full: {
                    type: 'boolean',
                    description: 'If true, ignore the on-disk cache and regenerate from supplied data. Default false.',
                },
                write_ledger: {
                    type: 'boolean',
                    description: 'Write plan/basecamp/ledger.md + ledger.json + cache/* (default true).',
                },
            },
            required: ['plugin_path', 'fetched_columns'],
        },
    },
    // ─── 17. Systemic Misalignment Checks (from Learnomy v1.3.0 lessons) ──
    {
        name: 'wppqa_check_wiring_completeness',
        description: 'Catches settings that save to the DB (admin form + handler + model + REST) but are never read by any student/frontend template. Class of bug proven by the Learnomy v1.3.0 sprint where 24 of 43 tracked settings were half-wired. Scans includes/admin/ for setting keys (name=, set_setting, $settings[...]) and templates/ for corresponding reads. Flags any setting discovered in admin that no template references.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    {
        name: 'wppqa_check_ux_guidelines',
        description: "Machine-enforces UX guidelines from the plugin's own docs/UX-GUIDELINES.md (or equivalent). Checks: CSS token compliance (no raw hex/px outside var(--prefix-*, fallback)), icon policy (no Dashicons, no emoji in views), human labels (no underscore-joined jargon), focus-visible (no outline:none without replacement), page header consistency (.prefix-page-header on editor/form views). Auto-detects CSS prefix from var(--xxx-*) usage.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 19. Plugin-Dev Skill Rules (admin-ux-rulebook + security + lifecycle) ──
    {
        name: 'wppqa_check_plugin_dev_rules',
        description: "Enforces rules from the wp-plugin-development Claude skill (~/.claude/skills/wp-plugin-development/references/). Checks: Rule 10 ban on alert()/confirm(); security rules (no iteration over $_POST/$_GET, nonces paired with current_user_can); lifecycle rules (activation hooks top-level, uninstall.php guards WP_UNINSTALL_PLUGIN); Rule 7 (no raw -1 in number inputs); inline onclick ban; 3-breakpoint discipline; 40px tap targets. The skill is widely used in WBcom plugins but its rules are never machine-enforced — this tool closes that gap.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 19a-bis. Focused security + code quality audit ─────────────
    // The pragmatic alternative to wppqa_audit_plugin (which runs all 11
    // checks and produces 600KB+ of mixed signal/noise). Only runs the
    // high-signal subset for "is this safe + is the code good?" — drops
    // every UX/templates/wiring-completeness/rest-js-contract heuristic
    // that generates false positives on plugins with non-standard patterns
    // (Interactivity API, settings via Models, etc.).
    {
        name: 'wppqa_security_quality_audit',
        description: "Focused security + code quality audit. Runs ONLY the high-signal trust-list checks: wppqa_check_plugin_dev_rules (security/UX rules from the wp-plugin-development skill: nonce-without-cap, $_POST iteration, alert/confirm ban, inline onclick, raw -1 inputs, tap targets, breakpoints) + plugin-check (WordPress.org PCP) + composer-audit (vendor vulnerabilities). Default returns ONLY high-severity findings (errors + high warnings); medium/low surfaced only when severity='all'. With strict=true, also runs phpcs and phpstan errors. Output ~10KB instead of wppqa_audit_plugin's 600KB+. Use this for PR gate / pre-release sanity / 'is this plugin safe to ship?'. Use wppqa_audit_plugin only for the broader review (UX, templates, market analysis, etc.) when you actually want all 11 checks.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                severity: {
                    type: 'string',
                    description: "Severity floor for findings. 'high' (default) returns only high-severity warnings + errors. 'medium' adds medium-severity warnings (e.g., breakpoint discipline). 'all' adds low-severity (tap targets, style nits).",
                    enum: ['high', 'medium', 'all'],
                },
                strict: {
                    type: 'boolean',
                    description: 'When true, also runs phpcs and phpstan and counts their errors as failures. Default false because pre-commit hooks usually already enforce these locally.',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 19b. Visual-regression check (live site — Playwright) ──────
    {
        name: 'wppqa_check_visual_regression',
        description: "Playwright screenshots every admin edit screen and verifies each uses the plugin's design-system wrappers (.{prefix}-admin-card, .{prefix}-page-header) and NOT the legacy WP <table class=\"form-table\"> pattern. Catches the visual-regression class proven by Learnomy v1.3.0 — Quiz + Question editors shipped with grep-clean markup but rendered as 2015 WP settings pages. The CSS prefix is auto-detected from --{prefix}-* usage (same logic as wppqa_check_ux_guidelines). Admin URLs are auto-discovered from add_submenu_page / add_menu_page, or supplied via admin_urls. Requires a running WP site with a ?autologin=1 mu-plugin. Degrades gracefully (skipped + info) when site_url is missing or Playwright is not installed.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Base URL of the running WP site (e.g. http://lms.local). Required for actual probes.',
                },
                autologin_param: {
                    type: 'string',
                    description: 'Query string used to trigger the dev-auto-login mu-plugin. Defaults to "?autologin=1".',
                },
                admin_urls: {
                    type: 'array',
                    description: 'Optional explicit list of admin edit URLs to probe. If omitted, URLs are discovered via add_submenu_page / add_menu_page scans.',
                    items: { type: 'string' },
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 19c. Enum consistency (admin/REST/service dialect drift) ────
    {
        name: 'wppqa_check_enum_consistency',
        description: "Catches the 'enum drift' bug class: the same logical value (grading_method, feedback_timing, content_type, question type) is hardcoded as a list in admin / REST / service / DB but those lists disagree — e.g. admin allows 'last' while the service reads 'latest', or REST whitelist has 5 values and the service implements only 2. Scans every PHP file for three patterns (in_array( $var, [...], true ), 'enum' => [...], switch ($var) { case... }), groups observations by the LHS variable + nearest column/setting context (walks up 20 lines for ->column_name or ['key_name']), and flags any group where 2+ files disagree on the set. Static-only — no live DB required.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 19d. REST ↔ JS contract drift ──────────────────────────────
    {
        name: 'wppqa_check_rest_js_contract',
        description: "Catches the 'envelope mismatch' silent-bug class proven by Learnomy's catalog-view.js — JS reads data.courses but Base_Controller now returns {data, meta.cursor_next}. Both isolated tests pass; live integration silently breaks. Static-only — no live HTTP: extracts every register_rest_route + its callback's response-shape keys (rest_ensure_response literals + return arrays), then scans assets/js/ and src/ for property accesses within 50 lines of a route URL reference. Flags any access whose property isn't in the PHP shape (wrapper keys like data/error/message/code are suppressed). Severity high — this class of bug causes UI-wide blank states.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 19e. Editor layout bias (sidebar-heavy vs content-empty) ───
    {
        name: 'wppqa_check_editor_layout_bias',
        description: "Catches 'Gutenberg-narrative layout but the plugin is metadata-heavy' editors — Learnomy's pre-Wave-A3 lesson-editor.php crammed 6 cards into a 280px sidebar while the main area had only Title + empty Content. Scans includes/admin/views/*editor.php|*form.php; identifies sidebar regions (class=*sidebar*, <aside>, role=complementary) vs main regions (class=*main*/*content*, <main>) and counts cards (.{prefix}-admin-card, .{prefix}-card, .{prefix}-settings-section, postbox/meta-box) + inputs (input/select/textarea excl. hidden + nonces). Flags: sidebar ≥4 cards AND main <3 inputs, OR sidebar input count >2x main. Severity medium.",
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 20. Full Audit (master tool) ─────────────────────────────
    {
        name: 'wppqa_audit_plugin',
        description: 'Complete plugin audit — the ONE command that runs everything: scan features, run all 11 code quality checks, evaluate product (admin + frontend + marketing), check UX, check templates, check a11y, analyze market gaps, and generate graded report. Optional live site checks (API, DB, browser) if site_url provided. Output formats: markdown (default), json, sarif, junit.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Optional Local WP site URL for live checks',
                },
                format: {
                    type: 'string',
                    enum: ['markdown', 'json', 'sarif', 'junit'],
                    description: 'Output format (default: markdown)',
                    default: 'markdown',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 21. Journey audit: scaffold journeys.json ────────────────
    {
        name: 'wppqa_audit_init_journeys',
        description: 'Scaffold `docs/audit/journeys.json` inside a plugin so the journey-by-journey customer-experience audit can run on it. By default, runs wppqa_scan_plugin first and auto-discovers customer-facing surfaces (CPTs, taxonomies, shortcodes, blocks, REST routes, admin pages, cron, CLI, DB tables, integrations) into a populated journeys list - guarantees 100% coverage of what the code declares. Pass `starter_only: true` to skip auto-discovery and use a generic 4-journey skeleton instead (useful for non-plugin paths or when the scanner cannot run). The plugin team then refines product_name, expectation copy, and journey grouping in the generated file.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                force: {
                    type: 'boolean',
                    description: 'Overwrite an existing journeys.json. Default: false (preserves existing).',
                    default: false,
                },
                starter_only: {
                    type: 'boolean',
                    description: 'Skip auto-discovery from wppqa_scan_plugin and use the generic starter skeleton instead. Default: false.',
                    default: false,
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 22a. Journey audit: coverage check ───────────────────────
    {
        name: 'wppqa_audit_coverage_check',
        description: 'Re-run wppqa_scan_plugin against the plugin and compare the discovered surfaces (CPTs, taxonomies, shortcodes, blocks, REST namespaces, AJAX handlers, admin pages, cron jobs, CLI commands, DB tables, detected integrations) against the journeys defined in `docs/audit/journeys.json`. Reports any surface in the manifest that is not mentioned anywhere in the journeys list. Use this to confirm 100% coverage before dispatching the audit; or to detect drift after new code lands.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 22b. Journey audit: build per-journey briefings ──────────
    {
        name: 'wppqa_audit_get_briefing',
        description: 'Read the plugin\'s `docs/audit/journeys.json` and return one Sonnet sub-agent briefing prompt per journey. The caller (Claude) dispatches each briefing to a parallel sub-agent via its own Agent tool. Each briefing tells the sub-agent to walk one customer journey, score every surface against the three-lens method (customer expectation / current reality / long-term fix) on the four-tier severity rubric (🟢 / 🟡 / 🔴 / ⚪), and write the findings to a per-journey markdown file. After all sub-agents finish, call wppqa_audit_consolidate_matrix with the list of output paths.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                site_url: {
                    type: 'string',
                    description: 'Optional Local WP site URL for the sub-agents to walk (e.g. http://forums.local). Defaults to http://localhost.',
                },
                output_dir: {
                    type: 'string',
                    description: 'Optional working directory where per-journey markdown reports will be saved. Defaults to a tmp dir keyed off the plugin name and timestamp.',
                },
            },
            required: ['plugin_path'],
        },
    },
    // ─── 23. Journey audit: consolidate matrix ────────────────────
    {
        name: 'wppqa_audit_consolidate_matrix',
        description: 'Merge the per-journey markdown reports produced by the parallel sub-agents into a single customer-experience matrix. Reads each report\'s summary table, aggregates severity counts, lists every 🔴 sorted by journey, lists 🟡 by journey, lists 🟢, and notes ⚪ skipped surfaces. Writes the matrix to the supplied output_path (typical: <plugin_path>/docs/audit/customer-experience-matrix.md). Returns severity totals plus a list of the red findings for quick triage.',
        inputSchema: {
            type: 'object',
            properties: {
                plugin_path: {
                    type: 'string',
                    description: 'Absolute path to the WordPress plugin directory',
                },
                report_paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of per-journey markdown file paths returned by the sub-agents.',
                },
                output_path: {
                    type: 'string',
                    description: 'Absolute path where the consolidated matrix will be written. Conventionally <plugin_path>/docs/audit/customer-experience-matrix.md.',
                },
            },
            required: ['plugin_path', 'report_paths', 'output_path'],
        },
    },
];
//# sourceMappingURL=tools.js.map