/**
 * WP Plugin QA MCP Server - Tool Definitions (v2.0.0)
 * 15 tools focused on product evaluation, not code linting.
 * Code quality checks are handled by WPCS MCP + Plugin Check PCP.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // ─── Discovery ─────────────────────────────────────────────────
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

  // ─── Functional Checks (live site) ─────────────────────────────
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
      'Check database integrity: custom table existence and schema, settings persistence in wp_options, CPT data in wp_posts, data cleanup on uninstall, orphaned data. Requires Local WP running.',
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
      'Generate Playwright test scripts for browser testing: admin page loads, JS console errors, responsive viewports, form submissions, block editor. NOTE: This tool generates .spec.ts files only — it does NOT execute tests. Use mode="export" to save scripts, then run with npx playwright test, or use the Playwright MCP tools for interactive testing.',
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

  // ─── Product Quality Checks ────────────────────────────────────
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
    name: 'wppqa_check_a11y',
    description:
      'Accessibility audit (WCAG 2.1 AA): form label associations, image alt attributes, ARIA role correctness, focus management in JS (modal focus trapping), color contrast in CSS, keyboard navigation support, screen reader text for icon-only buttons.',
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
    name: 'wppqa_evaluate_admin',
    description:
      'Admin settings & pages evaluation as a product reviewer would: settings organization (grouping, tabs), setting justification (clear purpose, no redundancy), labels & help text clarity, default value quality, admin page count & menu placement, capability gates, Settings API usage.',
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
    name: 'wppqa_evaluate_frontend',
    description:
      'Frontend output quality evaluation: shortcode output quality & fallbacks, block rendering & editor preview, template structure & WP patterns, CSS scoping & namespace, JS error handling & AJAX behavior, responsive CSS/media queries, widget form labels & output structure.',
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
    name: 'wppqa_evaluate_marketing',
    description:
      'Marketing fitness scorer: readme.txt content quality (not format — PCP does that), feature messaging & discoverability, onboarding/setup wizard presence, free/pro upsell model, documentation & support links, hook/API extensibility surface, WordPress.org profile readiness (banner, icon, screenshots, contributors, tags).',
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

  // ─── Market Fitness ────────────────────────────────────────────
  {
    name: 'wppqa_analyze_gaps',
    description:
      'Analyze a plugin for missing features and best practices. Uses conditional rules ("if you have CPTs, you should have REST API") and unconditional rules ("every plugin needs uninstall cleanup"). Returns a prioritized gap list with maturity scoring per feature area.',
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

  // ─── Reports ───────────────────────────────────────────────────
  {
    name: 'wppqa_generate_report',
    description:
      'Aggregate all checker results into a graded QA report (A-F). Shows category scores, prioritized bug list with fix suggestions, overall score out of 100. Supports multiple export formats: markdown (default), json, sarif, junit.',
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
        format: {
          type: 'string',
          enum: ['markdown', 'json', 'sarif', 'junit'],
          description: 'Output format (default: markdown)',
          default: 'markdown',
        },
      },
      required: ['plugin_path', 'results'],
    },
  },
  {
    name: 'wppqa_run_automated_qa',
    description:
      'Full automated product evaluation pipeline: scan plugin -> run product quality checks (UX, templates, a11y, admin eval, frontend eval, marketing) -> live site checks if URL provided (API, DB, browser) -> gap analysis -> generate graded report.',
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
  {
    name: 'wppqa_audit_plugin',
    description:
      'Complete product audit: scan features, evaluate admin experience, evaluate frontend output, assess marketing fitness, run UX/a11y/template checks, analyze feature gaps, and produce a unified report. The definitive "is this plugin ready to sell?" answer. Live site checks (API, DB, browser) included only if site_url provided.',
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
        format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Output format (default: markdown)',
          default: 'markdown',
        },
      },
      required: ['plugin_path'],
    },
  },
];
