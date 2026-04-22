/**
 * WP Plugin QA MCP Server - Visual Regression Checker
 *
 * The 5th systemic-misalignment check from LEARNOMY-LESSONS-LEARNED.md §5.
 *
 * Pattern this catches: grep-based UX checks say "compliant" because design-system
 * tokens are present in OTHER files. But a newer admin edit view quietly ships using
 * `<table class="form-table">` (legacy WP pattern) instead of the plugin's own
 * `.{prefix}-admin-card` / `.{prefix}-settings-section` wrappers. Text-only audits
 * miss it; Playwright screenshot of the rendered DOM catches it in 5 seconds.
 *
 * How it runs:
 *   1. Auto-discover admin URLs by scanning `add_submenu_page` / `add_menu_page` calls.
 *   2. For each URL matching editor|edit|new (the edit-screen heuristic), open it via
 *      Playwright using the site's ?autologin=1 mu-plugin convention.
 *   3. Screenshot to .wppqa-out/visual/{slug}.png.
 *   4. Query the rendered DOM for `.{prefix}-admin-card`, `.{prefix}-page-header`,
 *      and `<table class="form-table">`. Flag the screen if the card/header is missing
 *      or the legacy form-table is present.
 *
 * Graceful degradation: if Playwright is not available, site_url is missing, or the
 * site is unreachable, the tool returns a `skipped` result with an info-level issue
 * explaining the prerequisite — it never crashes the audit.
 */
import { existsSync } from 'fs';
import type { CheckerResult } from './types.js';
export interface VisualRegressionOptions {
    pluginPath: string;
    siteUrl?: string;
    autologinParam?: string;
    adminUrls?: string[];
    outputDir?: string;
    timeoutMs?: number;
}
export declare function checkVisualRegression(opts: VisualRegressionOptions): CheckerResult;
export { existsSync };
