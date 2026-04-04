/**
 * WP Plugin QA MCP Server - Internationalization (i18n) Checker
 * Text domain, __() wrappers, POT file, concatenated strings.
 * Note: Pure static analysis, no shell commands used.
 */
import type { CheckerResult } from './types.js';
export declare function checkI18n(pluginPath: string): CheckerResult;
