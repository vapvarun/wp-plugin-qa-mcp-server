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

## 16 Tools

### Phase 1: Scan & Plan
| Tool | Description |
|------|-------------|
| `wppqa_scan_plugin` | Scan a plugin directory and return a structured PluginManifest |
| `wppqa_generate_plan` | Generate a prioritized test plan from a manifest |
| `wppqa_run_full_scan` | Scan + generate test plan in one call |

### Phase 2: Automated Checks
| Tool | Description | Requires Site? |
|------|-------------|----------------|
| `wppqa_check_static` | Static code analysis | No |
| `wppqa_check_api` | REST/AJAX verification | Yes |
| `wppqa_check_database` | Database integrity | Yes |
| `wppqa_check_browser` | Playwright browser tests | Yes |
| `wppqa_check_ux` | Customer experience audit | No |
| `wppqa_check_templates` | Template/hook analysis | No |
| `wppqa_check_compat` | Compatibility checks | No |
| `wppqa_check_i18n` | Internationalization audit | No |
| `wppqa_check_performance` | Performance baseline | No |
| `wppqa_execute_item` | Run a single test item | Depends |

### Phase 3: Reporting
| Tool | Description |
|------|-------------|
| `wppqa_generate_report` | Graded QA report (A-F) from checker results |
| `wppqa_run_automated_qa` | Full pipeline: scan -> check all -> report |

### Phase 4: Market Research
| Tool | Description |
|------|-------------|
| `wppqa_market` | Find competitors, compare features, identify gaps, generate roadmap |

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
wppqa_market({ plugin_path: "/path/to/my-plugin" })
```
Searches WordPress.org, CodeCanyon, and Google for competitors. Returns feature matrix, gap analysis, USPs, monetization opportunities, and a prioritized roadmap.

```
wppqa_market({
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
├── tools.ts                 # Tool definitions (16 tools)
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
