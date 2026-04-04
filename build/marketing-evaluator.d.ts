/**
 * WP Plugin QA MCP Server - Marketing Fitness Evaluator (v2.0.0)
 * Evaluates marketability as a product marketer would.
 * Note: Pure static/filesystem analysis, no shell commands used.
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function evaluateMarketing(manifest: PluginManifest, pluginPath: string): CheckerResult;
