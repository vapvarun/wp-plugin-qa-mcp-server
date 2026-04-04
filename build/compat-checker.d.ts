/**
 * WP Plugin QA MCP Server - Compatibility Checker
 * PHP/WP deprecated functions, version compat, plugin conflicts.
 * Note: Pure static analysis, no shell commands used.
 */
import type { CheckerResult } from './types.js';
export declare function checkCompat(pluginPath: string): CheckerResult;
