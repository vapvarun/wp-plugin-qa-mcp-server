/**
 * WP Plugin QA MCP Server - REST to JS Contract Checker
 *
 * Catches the "REST envelope mismatch" bug class: JS reads `data.courses` but
 * the PHP controller refactor now returns `{data: [], meta: {...}}`. Both
 * isolated tests pass; live integration silently breaks.
 *
 * Learnomy example: catalog-view.js expected `{courses, next_cursor}` but
 * Base_Controller now returns `{data, meta.cursor_next}`.
 *
 * Static-only: no live HTTP. Extract PHP response shapes from controller
 * return statements, then grep JS near route URLs for property accesses that
 * aren't in the shape.
 */
import type { CheckerResult } from './types.js';
export declare function checkRestJsContract(pluginPath: string): CheckerResult;
