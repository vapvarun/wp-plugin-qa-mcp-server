/**
 * WP Plugin QA MCP Server - Wiring Completeness Checker
 *
 * Catches settings that save to DB (admin form + handler + model + REST) but
 * are never read by any student/frontend template. Class of bug proven by the
 * Learnomy v1.3.0 sprint — 24 of 43 tracked fields were in this state.
 *
 * Tuning (2026-04-18):
 *  - Broader blocklist of generic field names (shared across dozens of forms).
 *  - REST `args` maps in includes/api/ count as persistence-layer awareness.
 *  - apply_filters('..._defaults', [...]) arrays count as admin-aware.
 *  - Optional .wppqa.yml override declares per-plugin exclusions.
 */
import type { CheckerResult } from './types.js';
export declare function checkWiringCompleteness(pluginPath: string): CheckerResult;
