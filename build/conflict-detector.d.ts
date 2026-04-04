/**
 * WP Plugin QA MCP Server - Plugin Conflict Detector
 * Identifies patterns that commonly cause conflicts with other WordPress plugins.
 * Covers: hook collisions, namespace pollution, CSS conflicts, JS globals, REST route clashes.
 *
 * NOTE: Pure static analysis — reads PHP/JS/CSS source files only. No shell commands used.
 */
import type { CheckerResult } from './types.js';
export declare function checkConflicts(pluginPath: string): CheckerResult;
