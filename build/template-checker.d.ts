/**
 * WP Plugin QA MCP Server - Template & Developer Experience Checker
 * Override mechanism, developer hooks, do_action/apply_filters placement.
 * Note: Pure static analysis, no shell commands used.
 */
import type { CheckerResult } from './types.js';
export declare function checkTemplates(pluginPath: string): CheckerResult;
