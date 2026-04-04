/**
 * WP Plugin QA MCP Server - Admin Options Evaluator (v2.0.0)
 * Evaluates admin pages and settings as a product reviewer would.
 * Note: Pure static analysis, no shell commands used.
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function evaluateAdmin(manifest: PluginManifest, pluginPath: string): CheckerResult;
