/**
 * Code Quality Checker — runs external tools (PHPCS, PHPStan, ESLint,
 * Stylelint, PHP Compat) and static a11y grep checks.
 *
 * Uses execFileSync for safe command execution (no shell injection).
 * Handles missing tools gracefully (skip with info, not error).
 * Parses JSON output from tools and converts to CheckerIssue[].
 */
import type { CheckerResult } from './types.js';
type CodeCheckType = 'phpcs' | 'phpstan' | 'eslint' | 'stylelint' | 'phpcompat' | 'a11y-grep' | 'php-lint' | 'composer-audit' | 'i18n' | 'plugin-check' | 'bundle-size';
export declare function runAllCodeChecks(pluginPath: string): CheckerResult[];
export declare function runSingleCheck(pluginPath: string, check: CodeCheckType): CheckerResult;
export declare function runPhpcs(pluginPath: string): CheckerResult;
export declare function runPhpstan(pluginPath: string): CheckerResult;
export declare function runEslint(pluginPath: string): CheckerResult;
export declare function runStylelint(pluginPath: string): CheckerResult;
export declare function runPhpCompat(pluginPath: string): CheckerResult;
export declare function runA11yGrep(pluginPath: string): CheckerResult;
export declare function runPhpLint(pluginPath: string): CheckerResult;
export declare function runComposerAudit(pluginPath: string): CheckerResult;
export declare function runI18nCheck(pluginPath: string): CheckerResult;
export declare function runPluginCheck(pluginPath: string): CheckerResult;
export declare function runBundleSize(pluginPath: string): CheckerResult;
export {};
