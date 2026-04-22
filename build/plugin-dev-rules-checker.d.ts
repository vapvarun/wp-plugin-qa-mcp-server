/**
 * WP Plugin QA MCP Server - Plugin Development Rules Checker
 *
 * Enforces rules from the wp-plugin-development skill at
 *   ~/.claude/skills/wp-plugin-development/references/
 *
 * Rule groups mined:
 *   - admin-ux-rulebook: Rules 1-10 (alert/confirm ban, Dashicons, -1 values,
 *     role labels, page headers, etc.)
 *   - security.md: read explicit $_POST keys (no array-wide processing),
 *     prepared statements, sanitize-in escape-out
 *   - lifecycle.md: activation/deactivation hooks registered at top level;
 *     uninstall uses WP_UNINSTALL_PLUGIN
 *   - frontend-tokens.md: every CSS file references tokens
 *   - frontend-responsive.md: 3 breakpoints only (640/1024/1440ish),
 *     no 24+ breakpoint values, 40px minimum tap targets
 *
 * This check exists because the skill's rules are documented but never
 * machine-enforced. Every plugin that activates the skill should pass this.
 *
 * Tuning (2026-04-18):
 *  - nonce-no-cap: skip when the nonce is inside a handler that is (a)
 *    referenced by a `permission_callback` elsewhere in the codebase, or
 *    (b) declared inside a class that registers routes with
 *    `permission_callback`. Also skip when the file includes
 *    `Permission_Engine::can(` or another capability-engine surrogate
 *    within the same function body.
 *  - activation-nested: use brace-depth tracking from file start to the
 *    call site instead of whitespace heuristics. Still lightweight, no
 *    external AST.
 */
import type { CheckerResult } from './types.js';
export declare function checkPluginDevRules(pluginPath: string): CheckerResult;
