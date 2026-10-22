/**
 * WP Plugin QA MCP Server - Tool Definitions
 *
 * Covers RUNTIME behaviour and cross-layer STATIC checks that WPCS cannot do:
 * discovery (plugin scanner), product evaluation (admin / frontend), live
 * testing (REST, DB, browser, run_checks guards), role-matrix probing, plan
 * bootstrapping, Basecamp learning, the systemic-misalignment checks (wiring,
 * UX guidelines, plugin-dev rules, visual regression, enum consistency,
 * REST/JS contract, template contract, CSS contract, editor layout bias,
 * cross-reference data, qa coverage, scale), certification, and the
 * journey-by-journey customer-experience audit (init / coverage check /
 * briefing / consolidate matrix).
 *
 * Out of scope by ownership boundary: static code standards (php-lint,
 * PHPCompatibility, WPCS/phpcs, PHPStan) live in the wpcs MCP; market/strategy
 * analysis (gaps, category expectations, competitors) lives in the
 * product-strategy skill.
 *
 * Tool list is the source of truth; keep it in sync with server.ts
 * switch-cases and the `wppqa_*` allow-listed names in user settings.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const tools: Tool[];
