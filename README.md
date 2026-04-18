# WP Plugin QA MCP Server

An MCP (Model Context Protocol) server that provides comprehensive quality assurance for WordPress plugins. Point it at any plugin directory and get automated scanning, test plan generation, code analysis across 13 categories, and competitive market analysis — all without shell commands.

## What It Does

| Capability | Description |
|-----------|-------------|
| **Plugin Scanning** | Discovers all features: CPTs, taxonomies, shortcodes, blocks, REST routes, AJAX handlers, admin pages, settings, widgets, meta boxes, cron jobs, CLI commands, DB tables, templates, hooks, and cross-layer wiring |
| **Test Plan Generation** | Creates 80-300 prioritized test items across 13 categories with steps, expected results, and automation flags |
| **Static Analysis** | Dead code, duplicate functions, undefined calls, naming consistency, code pattern analysis |
| **Security Checks** | Nonce validation, capability checks, SQL injection patterns, XSS vectors, file operation safety |
| **API Verification** | REST endpoint + AJAX handler testing with auth/unauth access, input validation, response format checks |
| **Database Audit** | Custom table schema, settings persistence, CPT data integrity, orphaned data, autoload analysis |
| **Browser Testing** | Playwright-based admin page loads, JS console errors, responsive viewports, form submissions |
| **UX Audit** | Setting descriptions, error message quality, empty states, first-run experience, admin notices |
| **Template Analysis** | Theme override support, hook placement, template structure, lifecycle hooks, filter availability |
| **Compatibility** | PHP/WP deprecated functions, BuddyPress/WooCommerce integration, multisite support, hook conflicts |
| **i18n Audit** | Text domain consistency, translation wrapper coverage, POT file existence, string concatenation |
| **Performance** | DB query estimation, asset loading, autoload options, N+1 patterns, caching usage, script placement |
| **Competitive Analysis** | Market research across WordPress.org, CodeCanyon, and Google — feature comparison, gap analysis, roadmap |

## 17 Tools

### Discovery
| Tool | Description |
|------|-------------|
| `wppqa_scan_plugin` | Scan a plugin directory and return a structured PluginManifest (CPTs, taxonomies, shortcodes, blocks, REST routes, AJAX handlers, admin pages, settings, meta boxes, cron, CLI, DB tables, templates, hooks, cross-layer wiring) |

### Code Quality
| Tool | Description | Requires Site? |
|------|-------------|----------------|
| `wppqa_setup_quality` | Scaffold `.phpcs.xml.dist`, `phpstan.neon`, `.eslintrc`, `.stylelintrc`, `.editorconfig`, `.pa11yci` | No |
| `wppqa_run_code_checks` | Run ALL 14 code quality checks in one go (PHPCS, PHPStan, ESLint, Stylelint, PHPCompat, a11y grep, PHP lint, Composer audit, i18n, Plugin Check, bundle size, security, performance) | No |
| `wppqa_check_code_quality` | Run a single code quality check by name | No |
| `wppqa_check_a11y` | Full WCAG 2.1 AA audit (form labels, alt text, ARIA, focus, contrast, keyboard nav, screen-reader-text, outline:none, empty links, div-as-button, tabindex) | No |

### Product / UX / Templates
| Tool | Description | Requires Site? |
|------|-------------|----------------|
| `wppqa_evaluate_product` | Score admin, frontend, and marketing fitness in one pass | No |
| `wppqa_check_ux` | Help text, error messages, empty states, onboarding flow, consistency | No |
| `wppqa_check_templates` | Theme override paths, hooks in templates, lifecycle hook placement | No |

### Live-site Checks
| Tool | Description | Requires Site? |
|------|-------------|----------------|
| `wppqa_check_api` | Verify REST + AJAX against a running Local WP site (auth/unauth, nonce, input validation, response format) | Yes |
| `wppqa_check_database` | Custom table schema, settings persistence, CPT data, uninstall cleanup, orphaned data | Yes |
| `wppqa_check_browser` | Playwright-based admin page loads, JS console errors, responsive viewports, form submissions | Yes |
| `wppqa_probe_roles` | Hit every discovered REST endpoint + AJAX action as each configured role (guest / subscriber / advertiser / admin by default) and compare observed status to the route's declared `permission_callback`. Catches "advertiser portal calls a `manage_options`-gated route" bugs before they ship. | Yes |

### Static Data-flow Checks
| Tool | Description | Requires Site? |
|------|-------------|----------------|
| `wppqa_cross_reference_data` | Catalog every post_meta / user_meta / option / transient / DB column the plugin touches and flag stale-read stores (reader with no writer) as critical. Catches the exact "UI always shows 0" pattern that results from feature-wide key drift. | No |

### Plan / Bug-History Workflow
| Tool | Description | Requires Site? |
|------|-------------|----------------|
| `wppqa_bootstrap_plan` | Auto-generate a `plan/` folder for any plugin that doesn't have one — README, role-matrix.yml, fixtures/, flows/ stubs, regression/, coverage.md. Derived from the live manifest so every shortcode / REST route / admin page appears in coverage. | No |
| `wppqa_learn_from_basecamp` | Read `plan/basecamp.yml`, consume pre-fetched cards from basecamp-mcp (no duplicate API client), write `plan/basecamp/ledger.md` + `ledger.json` with fix-SHA extraction, module hot-spots, regression-fixture coverage, RFT aging, **Jaccard duplicate detection** against historical Done. Two-phase call with a local per-card cache — re-runs only pay for cards whose `updated_at` moved. | No (consumes pre-fetched data) |

### Market Research
| Tool | Description |
|------|-------------|
| `wppqa_analyze_market` | Find competitors, compare features, identify gaps, generate roadmap |

### Master
| Tool | Description |
|------|-------------|
| `wppqa_audit_plugin` | Complete plugin audit — scan + all 14 code quality checks + product evaluation + UX + templates + a11y + market gaps + graded A-F report. Optional live site checks when `site_url` is provided. Output: markdown, json, sarif, or junit. |

## Per-plugin `plan/` convention

Every plugin gets its own `plan/` folder that the tools consume as the
source of truth for manual and automated QA. `wppqa_bootstrap_plan`
generates it from a fresh scan; subsequent tools read it.

```
plan/
  README.md                  conventions + flow / regression schema
  coverage.md                feature × layer × role checklist
  role-matrix.yml            expected REST/AJAX status per role (wppqa_probe_roles)
  lessons.md                 classes of bugs we have shipped — permanent
  lessons.yml                machine-readable lesson gates
  basecamp.yml               per-plugin Basecamp project + column IDs
  basecamp/
    ledger.md                committed bug-history ledger
    ledger.json              machine-readable mirror
    cache/                   per-card cache keyed by updated_at
  fixtures/                  named DB seed states
  flows/                     executable end-user journeys (yml)
  regression/                one YAML per closed Basecamp card — permanent
```

See the full schema in
[`wb-ad-manager-pro/plan/README.md`](https://github.com/vapvarun/wb-ad-manager-pro/blob/1.5.0/plan/README.md)
which is the reference implementation.

## Setup

### Requirements
- Node.js 18+
- Claude Code with MCP support

### Install

```bash
git clone https://github.com/vapvarun/wp-plugin-qa-mcp-server.git
cd wp-plugin-qa-mcp-server
npm install
npm run build
```

### Configure in Claude Code

Add to your MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "wp-plugin-qa": {
      "command": "node",
      "args": ["/path/to/wp-plugin-qa-mcp-server/build/index.js"]
    }
  }
}
```

## Usage Examples

### Full Automated QA (one command)
```
wppqa_run_automated_qa({ plugin_path: "/path/to/my-plugin" })
```
Returns a graded report with scores across all 13 categories, prioritized bug list, and fix suggestions.

### With Live Site Checks
```
wppqa_run_automated_qa({
  plugin_path: "/path/to/my-plugin",
  site_url: "http://my-site.local"
})
```
Adds REST API, database, and browser testing on top of static checks.

### Competitive Analysis
```
wppqa_competitive_analysis({ plugin_path: "/path/to/my-plugin" })
```
Searches WordPress.org, CodeCanyon, and Google for competitors. Returns feature matrix, gap analysis, USPs, monetization opportunities, and a prioritized roadmap.

```
wppqa_competitive_analysis({
  plugin_path: "/path/to/my-plugin",
  search_keywords: "membership,user registration",
  max_competitors: 15
})
```

### Scan Only
```
wppqa_scan_plugin({ plugin_path: "/path/to/my-plugin" })
```

### Individual Checks
```
wppqa_check_static({ plugin_path: "/path/to/my-plugin" })
wppqa_check_i18n({ plugin_path: "/path/to/my-plugin" })
wppqa_check_performance({ plugin_path: "/path/to/my-plugin" })
```

## Architecture

```
src/
├── index.ts                 # Entry point
├── server.ts                # MCP server + tool handlers
├── tools.ts                 # Tool definitions (17 tools)
├── types.ts                 # TypeScript interfaces
├── scanner.ts               # Plugin scanner (21 regex scanners)
├── plan-generator.ts        # Test plan generator
├── shared-utils.ts          # File utilities
├── static-checker.ts        # Static analysis
├── api-checker.ts           # REST/AJAX verification
├── db-checker.ts            # Database checks
├── browser-runner.ts        # Playwright integration
├── ux-checker.ts            # UX audit
├── template-checker.ts      # Template analysis
├── compat-checker.ts        # Compatibility checks
├── i18n-checker.ts          # i18n audit
├── perf-checker.ts          # Performance analysis
├── report-builder.ts        # Report aggregation
└── competitive-analyzer.ts  # Market research
```

All checks are static analysis or HTTP-based. No shell commands are executed.

## License

GPL-2.0-or-later
