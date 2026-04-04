/**
 * WP Plugin QA MCP Server - Tool Definitions (v3.0.0)
 * 13 tools: discovery, code quality, product evaluation, live testing, market analysis.
 * Consolidated from 18 tools — no duplicates.
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
        description: 'Run a SINGLE code quality check by name. Use when you want just one tool instead of all 11.',
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
                    description: 'Which quality check to run',
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
    // ─── 13. Full Audit (master tool) ─────────────────────────────
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
];
//# sourceMappingURL=tools.js.map