/**
 * WP Plugin QA MCP Server - Performance Checker
 * DB query patterns, asset loading, autoload, N+1, caching.
 * Note: Pure static analysis of PHP files, no shell commands used.
 */
import type { CheckerResult } from './types.js';
export declare function checkPerformance(pluginPath: string): CheckerResult;
