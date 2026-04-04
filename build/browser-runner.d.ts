/**
 * WP Plugin QA MCP Server - Browser Test Script Generator
 * Generates Playwright test scripts for admin pages, blocks, responsive testing.
 * IMPORTANT: This tool generates .spec.ts files only — it does NOT execute browser tests.
 * For actual browser testing, use the Playwright MCP tools (browser_navigate, browser_snapshot, etc.)
 * or run the exported scripts with: npx playwright test
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function checkBrowser(manifest: PluginManifest, siteUrl: string, options?: {
    exportDir?: string;
}): CheckerResult;
