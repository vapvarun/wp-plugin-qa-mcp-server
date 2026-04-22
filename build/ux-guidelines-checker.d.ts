/**
 * WP Plugin QA MCP Server - UX Guidelines Enforcement Checker
 *
 * Machine-checks rules from docs/UX-GUIDELINES.md (or equivalent). Rules fired:
 *   1. CSS token compliance — no raw hex/px outside var(--prefix-*, fallback)
 *   2. Icon policy — no Dashicons, no emoji in UI
 *   3. Human labels — label text with underscore-joined words flagged as jargon
 *   4. Raw focus outline — `outline: none` without a matching :focus-visible
 *   5. Page header consistency — admin edit views should include .prefix-page-header
 *
 * Tuning (2026-04-18):
 *  - Block-aware parser replaces the single-pass :root/:host/.class regex.
 *    Any rule block that contains at least one `--prefix-*:` declaration is
 *    treated as a token-source block and skipped — including `:root, .class`
 *    combined selectors with comma-separated lists.
 *  - Same-line var() fallback detection is per-match: track paren depth
 *    along the line and determine whether the match sits inside `var(...)`.
 *    `padding: var(--lrn-sp-4, 16px) 20px` now correctly flags the `20px`
 *    while leaving the `16px` fallback alone.
 *  - Broader safelist: translate()/calc()/hairline-borders/inset/
 *    line-height/@media breakpoints, plus @keyframes frame positions.
 *  - Prefix auto-detection tie-breaks by presence in `{prefix}.css` /
 *    `{prefix}-NAME.css` filenames.
 */
import type { CheckerResult } from './types.js';
export declare function checkUxGuidelines(pluginPath: string): CheckerResult;
