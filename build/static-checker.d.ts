/**
 * WP Plugin QA MCP Server - Static Code Checker
 * Dead code, duplicates, undefined functions, naming consistency, debug statements, secrets, SSRF.
 * Security-specific checks (dangerous functions, SQL injection, object injection, ABSPATH guards)
 * are handled by security-checker.ts, wporg-checker.ts, and perf-checker.ts respectively.
 * Note: This is a standalone MCP server - no external exec dependencies.
 */
import type { CheckerResult } from './types.js';
export declare function checkStatic(pluginPath: string, siteUrl?: string): CheckerResult;
/** Reset WP-CLI cache between separate tool invocations */
export declare function resetWpCliCache(): void;
