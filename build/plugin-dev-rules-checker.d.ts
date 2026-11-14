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
/**
 * Collect the REST handlers that are authorized at the route layer: a route
 * `callback` whose own args array also carries a `permission_callback` (other
 * than `__return_true`), plus the permission callbacks themselves. A nonce
 * check inside one of those does not need a sibling current_user_can().
 *
 * `$this` callbacks are keyed to the file that registers them, so a handler
 * of the same name in another class is not exempted by accident.
 * ponytail: name-based, not type-resolved. A `[ $other, 'name' ]` or
 * `'Class::name'` callable exempts every function called `name`; resolve the
 * class through the php-ast sidecar if that ever hides a real finding.
 */
export declare function collectRestProtectedHandlers(phpFiles: string[]): {
    names: Set<string>;
    byFile: Map<string, Set<string>>;
};
/**
 * Body of the innermost function, method or closure containing idx, or null
 * at file top level. Brace-counted, so a brace inside a string can end it early.
 */
export declare function enclosingFunctionBody(content: string, idx: number): string | null;
