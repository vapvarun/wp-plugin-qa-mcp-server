/**
 * WP Plugin QA MCP Server - API Checker
 * REST endpoint + AJAX handler verification via HTTP.
 * Uses native Node.js fetch (no shell commands).
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function checkApi(manifest: PluginManifest, siteUrl: string): Promise<CheckerResult>;
