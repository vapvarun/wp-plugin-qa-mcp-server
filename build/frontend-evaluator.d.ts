/**
 * WP Plugin QA MCP Server - Frontend Output Evaluator (v2.0.0)
 * Evaluates what users actually SEE — shortcodes, blocks, templates, CSS, JS.
 * Note: Pure static analysis, no shell commands used.
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function evaluateFrontend(manifest: PluginManifest, pluginPath: string): CheckerResult;
