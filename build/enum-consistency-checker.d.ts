/**
 * WP Plugin QA MCP Server - Enum Consistency Checker
 *
 * Catches the "enum drift" bug class: the same logical value (question type,
 * grading method, feedback timing, content type) is hardcoded as a list in
 * 3-5 places, and those places disagree — admin says `last`, service reads
 * `latest`; admin whitelist is 3 values, REST whitelist is 5, service
 * implements 2.
 *
 * Static-only: scans PHP for 3 patterns, groups by LHS variable + nearest
 * setting/column context, flags when 2+ files disagree on the set.
 */
import type { CheckerResult } from './types.js';
export declare function checkEnumConsistency(pluginPath: string): CheckerResult;
