/**
 * WP Plugin QA MCP Server - Tool Definitions (v3.0.0)
 * 13 tools: discovery, code quality, product evaluation, live testing, market analysis.
 * Consolidated from 18 tools — no duplicates.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // ─── 1. Discovery ─────────────────────────────────────────────
  {
    name: 'wppqa_scan_plugin',
    description:
      'Scan a WordPress plugin directory to discover all features: CPTs, taxonomies, shortcodes, blocks, REST routes, AJAX handlers, admin pages, settings, widgets, meta boxes, cron jobs, CLI commands, DB tables, templates, hooks, and integrations. Returns structured PluginManifest JSON with cross-layer wiring analysis.',
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
    description:
      'Scaffold all code quality config files in a plugin: .phpcs.xml.dist, phpstan.neon, .eslintrc.json, .eslintignore, .stylelintrc.json, .editorconfig, .pa11yci. Auto-detects text domain from plugin header, finds JS globals from wp_localize_script, adds phpstan to composer.json. Skips files that already exist.',
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
    description:
      'Run ALL 14 code quality checks: PHPCS (WordPress coding standards), PHPStan (static analysis), ESLint (JavaScript), Stylelint (CSS), PHP Compatibility (7.4-8.4), a11y grep (outline:none, empty links), PHP lint (syntax), Composer audit (vulnerabilities), i18n (translations), Plugin Check PCP (WordPress.org compliance), bundle size. Returns unified report. Skips tools not installed.',
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
    description:
      'Run a SINGLE code quality check by name. Use when you want just one tool instead of all 11.',
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
    description:
      'Full WCAG 2.1 AA accessibility audit combining static analysis and pattern grep: form labels, image alt text, ARIA usage, focus management, color contrast, keyboard navigation, screen-reader-text, outline:none detection, empty links, div-as-button, positive tabindex.',
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
    description:
      'Evaluate plugin product quality across admin UI, frontend output, and marketing readiness. Combines admin settings evaluation, frontend rendering quality, and marketing fitness scoring into one tool.',
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
    description:
      'UX and customer experience audit: help text coverage, error messages, empty states, visual feedback, settings organization, onboarding flow, consistency.',
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
    description:
      'Theme override and hook analysis: template files, override paths, hooks in templates, lifecycle hooks (activation, deactivation, uninstall), filter/action placement.',
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
    description:
      'Verify REST endpoints and AJAX handlers against a running Local WP site. Tests auth/unauth access, nonce validation, malformed input handling, response format. Requires Local WP running.',
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
    description:
      'Check database integrity: custom table existence and schema, settings persistence, CPT data, cleanup on uninstall, orphaned data. Requires Local WP running.',
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
    description:
      'Generate Playwright E2E test specs based on discovered features. Creates test files for admin pages, settings, CPTs, shortcodes, blocks. Requires site_url.',
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
    description:
      'Analyze plugin market position: feature gaps vs market expectations, maturity scoring, competitor comparison (WordPress.org, CodeCanyon), roadmap suggestions. Combines gap analysis and competitive research.',
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
    description:
      "Probe every discovered REST endpoint and AJAX action as each WordPress role (guest/subscriber/advertiser/admin by default) and report where observed HTTP status diverges from what the route's permission_callback says should happen. Catches capability/role mismatches — e.g. advertiser-portal routes accidentally gated with manage_options that would 403 in production — before release.",
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
          description:
            'Optional role profiles to probe. If omitted, uses the default set (guest, subscriber, advertiser, admin) assuming the wbam_dev_as dev-auto-login mu-plugin is installed.',
          items: { type: 'object' },
        },
      },
      required: ['plugin_path', 'site_url'],
    },
  },

  // ─── 14. Write↔Read data cross-reference ──────────────────────
  {
    name: 'wppqa_cross_reference_data',
    description:
      'Catalog every data store the plugin touches (post_meta, user_meta, term_meta, option, transient, custom DB tables/columns) and cross-reference writers against readers. Catches stale-read bugs where a template reads a key nothing ever writes to — the exact pattern that produces "UI always shows 0" regressions — plus stale-write keys (wasted I/O) and orphaned stores.',
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
    description:
      'Auto-generate the full plan/ folder for a plugin that does not have one yet, derived from the live manifest so every shortcode / REST route / admin page gets a flow stub and appears in coverage.md. Skips existing files unless overwrite is set, and returns a report of created + skipped paths plus a human next-steps checklist.',
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
    description:
      'Plugin-agnostic Basecamp ledger generator with a local per-card cache. Reads plan/basecamp.yml, consumes pre-fetched data (this tool does NOT talk to Basecamp), and writes plan/basecamp/ledger.md + ledger.json + cache/columns.json + cache/cards/{id}.json so future sessions carry full bug history — fix SHAs, reopen patterns, module hot-spots, regression-fixture coverage, title-similarity duplicate detection — without re-querying Basecamp for unchanged cards. Two-phase call — first invocation with compact listings (fetched_columns) returns needsFetch; orchestrator fetches those via basecamp-mcp (basecamp_get_card + basecamp_list_comments) and re-calls with fetched_full_cards + fetched_comments populated.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the plugin directory containing plan/basecamp.yml.',
        },
        fetched_columns: {
          type: 'object',
          description:
            'Required. Compact listings keyed by column name (matches plan/basecamp.yml keys). Each value is an array of { id, title, updated_at, created_at?, app_url?, comments_count?, assignees? }. Obtain via basecamp_list_card_ids per column.',
        },
        fetched_full_cards: {
          type: 'object',
          description:
            'Optional. Full card bodies keyed by card id, supplied only for ids the tool reported as needsFetch.cards on a previous call (or all ids on a first run). Each value is { id, title, created_at, updated_at, content, app_url, comments_count, creator }. Obtain via basecamp_get_card.',
        },
        fetched_comments: {
          type: 'object',
          description:
            'Optional. Comments keyed by card id, supplied only for ids the tool reported as needsFetch.comments. Each value is an array of { content, created_at?, creator? }. Obtain via basecamp_list_comments.',
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

  // ─── 17. Full Audit (master tool) ─────────────────────────────
  {
    name: 'wppqa_audit_plugin',
    description:
      'Complete plugin audit — the ONE command that runs everything: scan features, run all 11 code quality checks, evaluate product (admin + frontend + marketing), check UX, check templates, check a11y, analyze market gaps, and generate graded report. Optional live site checks (API, DB, browser) if site_url provided. Output formats: markdown (default), json, sarif, junit.',
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
