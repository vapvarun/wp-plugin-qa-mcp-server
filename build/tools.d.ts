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
import { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const tools: Tool[];
