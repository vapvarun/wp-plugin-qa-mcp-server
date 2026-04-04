/**
 * WP Plugin QA MCP Server - WordPress.org Submission Readiness Checker
 * Checks all common reasons plugins get rejected from the WordPress.org review queue.
 * Based on the Plugin Review Team's documented guidelines and 59,137 issues found in 2025.
 */
import type { CheckerResult } from './types.js';
export declare function checkWpOrgReady(pluginPath: string): CheckerResult;
