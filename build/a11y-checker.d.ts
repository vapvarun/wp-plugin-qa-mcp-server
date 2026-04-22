/**
 * WP Plugin QA MCP Server - Accessibility Checker
 *
 * Static analysis for accessibility issues based on WCAG 2.1 AA.
 *
 * Design principle: parse HTML tags as whole units (across line breaks)
 * and consider surrounding context — not line-by-line grep. A line-only
 * grep produced a high false-positive rate on plugins that use the
 * common WP multi-line formatting pattern, e.g.:
 *
 *   <input
 *       type="number"
 *       id="x"
 *       aria-label="…"
 *   />
 *
 * where a line-level regex sees only `<input` on line 1 and declares
 * there is no aria-label.
 */
import type { CheckerResult } from './types.js';
export declare function checkAccessibility(pluginPath: string): CheckerResult;
