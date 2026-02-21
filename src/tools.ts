/**
 * WP Plugin QA MCP Server - Tool Definitions
 * 16 tools for comprehensive WordPress plugin QA
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // ─── Phase 1: Scan & Plan ─────────────────────────────────────
  {
    name: 'wppqa_scan_plugin',
    description:
      'Scan a WordPress plugin directory to discover all features: CPTs, taxonomies, shortcodes, blocks, REST routes, AJAX handlers, admin pages, settings, widgets, meta boxes, cron jobs, CLI commands, DB tables, templates, and hooks. Returns a structured PluginManifest JSON with cross-layer wiring analysis.',
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
    name: 'wppqa_generate_plan',
    description:
      'Generate a prioritized test plan from a PluginManifest. Creates 80-300 TestItems across 13 categories (smoke, functionality, code quality, security, API, database, browser, UX, templates, action audit, compatibility, i18n, performance). Each test has priority, automation status, and detailed steps.',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: {
          type: 'string',
          description: 'PluginManifest JSON string (output from wppqa_scan_plugin)',
        },
      },
      required: ['manifest'],
    },
  },
  {
    name: 'wppqa_run_full_scan',
    description:
      'Scan a plugin AND generate its test plan in one call. Combines wppqa_scan_plugin + wppqa_generate_plan. Returns both the manifest and the test plan.',
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

  // ─── Phase 2: Static Checks (Group A) ─────────────────────────
  {
    name: 'wppqa_check_static',
    description:
      'Static code analysis: dead code detection, duplicate/similar functions, undefined function calls, naming consistency (plugin prefix), code pattern consistency. No running site needed.',
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
    name: 'wppqa_check_api',
    description:
      'Verify REST endpoints and AJAX handlers against a running Local WP site. Tests auth/unauth access, nonce validation, malformed input handling, response format consistency. Requires Local WP running.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        site_url: {
          type: 'string',
          description: 'Local WP site URL (e.g., http://buddypress-dev.local)',
        },
      },
      required: ['plugin_path', 'site_url'],
    },
  },
  {
    name: 'wppqa_check_database',
    description:
      'Check database integrity: custom table existence and schema, settings persistence in wp_options, CPT data in wp_posts, data cleanup on uninstall, orphaned data, autoload appropriateness. Requires Local WP running.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        site_url: {
          type: 'string',
          description: 'Local WP site URL (e.g., http://buddypress-dev.local)',
        },
      },
      required: ['plugin_path', 'site_url'],
    },
  },
  {
    name: 'wppqa_check_browser',
    description:
      'Playwright-based browser testing: admin page loads, JS console errors, responsive viewports (375/768/1024px), form submissions, block editor operations. Can run directly or export scripts. Requires Local WP running.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        site_url: {
          type: 'string',
          description: 'Local WP site URL (e.g., http://buddypress-dev.local)',
        },
        mode: {
          type: 'string',
          enum: ['direct', 'export'],
          description: 'Run Playwright directly or export scripts for manual execution (default: export)',
          default: 'export',
        },
      },
      required: ['plugin_path', 'site_url'],
    },
  },
  {
    name: 'wppqa_check_ux',
    description:
      'Customer experience audit: setting descriptions/help text, error message quality, empty state handling, first-run experience, admin notice clarity, success feedback visibility.',
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
    name: 'wppqa_check_templates',
    description:
      'Template and developer experience audit: theme override support, do_action/apply_filters hook placement, template structure, lifecycle hooks, filter availability, hook discoverability and context passing.',
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
    name: 'wppqa_check_compat',
    description:
      'Compatibility analysis: PHP deprecated function usage, WordPress deprecated function usage, BuddyPress/WooCommerce integration checks, multisite support, hook priority conflicts, script dependency validation.',
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
    name: 'wppqa_check_i18n',
    description:
      'Internationalization audit: text domain consistency, __()/_e() wrapper coverage, POT file existence, no concatenated translatable strings, proper plural forms, no HTML in translatable strings, load_plugin_textdomain check.',
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
    name: 'wppqa_check_performance',
    description:
      'Performance baseline analysis: DB query count estimation, asset loading audit, autoload option check, N+1 query pattern detection, caching usage, script footer loading, asset count.',
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

  // ─── Phase 2: Single Item Execution ───────────────────────────
  {
    name: 'wppqa_execute_item',
    description:
      'Execute a single TestItem from the test plan and return pass/fail result. For automated items, runs the check directly. For manual items, returns the test steps for human execution.',
    inputSchema: {
      type: 'object',
      properties: {
        test_item: {
          type: 'string',
          description: 'TestItem JSON string to execute',
        },
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        site_url: {
          type: 'string',
          description: 'Local WP site URL (needed for live tests)',
        },
      },
      required: ['test_item', 'plugin_path'],
    },
  },

  // ─── Phase 3: Report ──────────────────────────────────────────
  {
    name: 'wppqa_generate_report',
    description:
      'Aggregate all checker results into a graded QA report (A-F). Shows 13 category scores, prioritized bug list with fix suggestions, overall score out of 100.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        results: {
          type: 'string',
          description: 'JSON string of all CheckerResult arrays from previous checks',
        },
      },
      required: ['plugin_path', 'results'],
    },
  },
  {
    name: 'wppqa_run_automated_qa',
    description:
      'Full automated QA pipeline: scan plugin -> generate test plan -> execute all automated checks (static, templates, i18n, compat, UX, performance) -> generate graded report. One command for complete QA. Live site checks (API, DB, browser) are included only if site_url is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        site_url: {
          type: 'string',
          description: 'Optional Local WP site URL for live checks (REST, AJAX, DB, browser)',
        },
      },
      required: ['plugin_path'],
    },
  },

  // ─── Phase 4: Competitive Analysis ─────────────────────────────
  {
    name: 'wppqa_competitive_analysis',
    description:
      'Market research: scans plugin, finds competitors on WordPress.org + CodeCanyon + Google, extracts features from descriptions, compares feature sets, identifies gaps/USPs, and generates prioritized roadmap with monetization opportunities.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_path: {
          type: 'string',
          description: 'Absolute path to the WordPress plugin directory',
        },
        search_keywords: {
          type: 'string',
          description: 'Comma-separated keywords for competitor search (auto-derived if not provided)',
        },
        max_competitors: {
          type: 'number',
          description: 'Max competitors to analyze in detail (default: 10, max: 15)',
        },
      },
      required: ['plugin_path'],
    },
  },
];
