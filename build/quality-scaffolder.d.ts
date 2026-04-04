/**
 * Quality Scaffolder — creates config files for code quality tools.
 * Given a plugin_path, generates .phpcs.xml.dist, phpstan.neon,
 * .eslintrc.json, .eslintignore, .stylelintrc.json, .editorconfig, .pa11yci.
 *
 * Smart features:
 * - Reads plugin header for text domain and WP version
 * - Greps wp_localize_script calls to find JS globals for ESLint
 * - Checks if files already exist (skips with message)
 * - Adds phpstan dev dependencies to composer.json if missing
 */
export interface ScaffoldResult {
    created: string[];
    skipped: string[];
    updated: string[];
    errors: string[];
}
export declare function scaffoldQualityConfigs(pluginPath: string, siteUrl?: string): ScaffoldResult;
export declare function detectJsGlobals(pluginPath: string): string[];
