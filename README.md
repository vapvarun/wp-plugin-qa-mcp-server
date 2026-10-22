# WP Plugin QA MCP Server

An MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for the
**runtime and cross-layer QA** of WordPress plugins. Point it at a plugin (and,
for the live checks, a running site) and it exercises behaviour that static
linting can't see: REST/AJAX against a real site, role-by-role authorization,
settings-saved-but-never-read wiring, REST-shape vs JS-reads contract drift,
template contracts, and full user-journey audits.

Some checks are pure file analysis; the live ones drive wp-cli / HTTP / a
Playwright browser against a Local WP site.

## Where this fits (one check, one owner)

This server deliberately does **not** re-run coding-standards or static analysis
— that belongs to its sibling and would just duplicate work:

- **Static standards** (php -l, WPCS/phpcs, PHP compatibility, PHPStan, project
  validation) -> [wpcs-mcp-server](https://github.com/vapvarun/wpcs-mcp-server)
- **Runtime + cross-layer QA** (this server)
- **Security sniffs** -> Plugin Check at the release gate; **authorization** ->
  this server's `wppqa_probe_roles`
- **Market / competitive / roadmap strategy** -> the `product-strategy` skill
  (moved out of here — it was never QA)

## Tools (28)

### Discovery
| Tool | Description |
|------|-------------|
| `wppqa_scan_plugin` | Scan a plugin and return a structured manifest (CPTs, taxonomies, shortcodes, blocks, REST routes, AJAX handlers, admin pages, settings, meta boxes, cron, CLI, DB tables, templates, hooks, cross-layer wiring) |

### Live guard gate (start here)
| Tool | Requires site? | Description |
|------|---|-------------|
| `wppqa_run_checks` | Yes (release checks: no) | Runs every check a plugin declares in `docs/qa/qa-config.json` (save round-trips, form/REST parity, fixture states, presentation on the theme×width matrix in light and dark, crawl, release refs) and holds the result against `audit/escapes.json` |

### Cross-layer static (what WPCS can't do)
| Tool | Description |
|------|-------------|
| `wppqa_check_wiring_completeness` | Settings written but never read by any frontend/render path |
| `wppqa_check_rest_js_contract` | PHP REST response shape vs the properties the JS actually reads |
| `wppqa_check_css_contract` | CSS the markup promises vs what ships |
| `wppqa_check_enum_consistency` | The same enum hardcoded and drifting across files |
| `wppqa_check_template_contract` | Loader ↔ template variable contract drift |
| `wppqa_cross_reference_data` | Map every meta/option/transient/DB column read & written; flag stale-read stores (reader with no writer) — the "UI always shows 0" pattern |
| `wppqa_check_qa_coverage` | Manifest → test coverage gate, baseline-shrink |
| `wppqa_check_templates` | Theme override paths, hooks in templates, lifecycle hook placement |

### Runtime / live-site
| Tool | Description |
|------|-------------|
| `wppqa_check_api` | REST + AJAX against a running Local WP site (auth/unauth, nonce, input validation, response format) |
| `wppqa_check_database` | Custom table schema, settings persistence, CPT data, uninstall cleanup, orphaned data |
| `wppqa_check_browser` | Playwright admin page loads, JS console errors, responsive viewports, form submissions |
| `wppqa_probe_roles` | Fire every REST/AJAX route as each configured role and compare observed status to the route's declared `permission_callback` — catches "subscriber reaches a `manage_options` route" before it ships |
| `wppqa_check_scale` | Index coverage, unbounded reads, N+1 patterns at scale |

### Product & accessibility
| Tool | Description |
|------|-------------|
| `wppqa_evaluate_product` | Score admin + frontend product fitness (help text, empty states, first-run, consistency) |
| `wppqa_check_a11y` | WCAG 2.1 AA audit (labels, alt text, ARIA, focus, contrast, keyboard nav, screen-reader-text, empty links, div-as-button, tabindex) |

### Readiness & audit workflows
| Tool | Description |
|------|-------------|
| `wppqa_audit_plugin` | Umbrella audit: scan + product + cross-layer + optional live checks → graded report (markdown / json / sarif / junit). Standards are deferred to the wpcs MCP |
| `wppqa_readiness` / `wppqa_readiness_portfolio` | Release-readiness scorecard for one plugin / a whole tree |
| `wppqa_audit_init_journeys` / `wppqa_audit_coverage_check` / `wppqa_audit_get_briefing` / `wppqa_audit_consolidate_matrix` | Journey-by-journey CX audit orchestration |
| `wppqa_certify` / `wppqa_audit` | Run a plugin's in-repo certification engine and transport its ledger |

### Plan & bug-history
| Tool | Description |
|------|-------------|
| `wppqa_bootstrap_plan` | Generate a `plan/` folder (README, role-matrix, fixtures, flows, regression, coverage) derived from the live manifest |
| `wppqa_learn_from_basecamp` | Consume pre-fetched Basecamp cards into `plan/basecamp/ledger.*` with fix-SHA extraction, hot-spots, RFT aging, and Jaccard duplicate detection |

## Per-plugin `plan/` convention

Each plugin gets a `plan/` folder the tools treat as the source of truth for
manual + automated QA. `wppqa_bootstrap_plan` generates it from a fresh scan;
the other tools read it.

```
plan/
  README.md                 conventions + flow / regression schema
  coverage.md               feature x layer x role checklist
  role-matrix.yml           expected REST/AJAX status per role (wppqa_probe_roles)
  lessons.md / lessons.yml  classes of bugs we have shipped - permanent
  basecamp.yml              per-plugin Basecamp project + column IDs
  basecamp/                 committed bug-history ledger + per-card cache
  fixtures/                 named DB seed states
  flows/                    executable end-user journeys (yml)
  regression/               one YAML per closed Basecamp card - permanent
```

## Setup

Requirements: Node.js 18+. The live checks additionally need wp-cli, a Local WP
site, and (for `wppqa_check_browser`) Playwright.

```bash
git clone https://github.com/vapvarun/wp-plugin-qa-mcp-server.git
cd wp-plugin-qa-mcp-server && npm install   # the compiled build/ is also tracked
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "wp-plugin-qa": {
      "command": "node",
      "args": ["/absolute/path/to/wp-plugin-qa-mcp-server/build/index.js"]
    }
  }
}
```

Other machines just `git pull` and use it — `build/` is tracked.

## Usage examples

```
wppqa_scan_plugin({ plugin_path: "/path/to/my-plugin" })
wppqa_audit_plugin({ plugin_path: "/path/to/my-plugin", site_url: "http://my-site.local" })
wppqa_probe_roles({ plugin_path: "/path/to/my-plugin", site_url: "http://my-site.local" })
wppqa_cross_reference_data({ plugin_path: "/path/to/my-plugin" })
wppqa_readiness({ plugin_path: "/path/to/my-plugin" })
```

For coding standards on the same plugin, use the
[wpcs MCP](https://github.com/vapvarun/wpcs-mcp-server) — this server will not
re-run phpcs/PHPStan.

## Built by Wbcom Designs

This is one of the internal helper tools we use at
**[Wbcom Designs](https://wbcomdesigns.com)** to keep 100+ WordPress plugins and
themes healthy across releases — the runtime QA harness that walks our own
products before they ship.

We build community and commerce for WordPress: **BuddyPress / BuddyBoss**
community add-ons, **WooCommerce** extensions, and the **Reign** and **BuddyX**
themes. If this harness helps you ship more reliable WordPress plugins, the
products it keeps healthy might help you build your community or store — browse
them at **[wbcomdesigns.com](https://wbcomdesigns.com)**.

## License

GPL-2.0-or-later
