/**
 * WP Plugin QA MCP Server - Performance / Big-Site Scale Checker
 *
 * Deterministic gate for the portfolio "big-site readiness" bar: a list/table/
 * data method must work at 2000+ rows on day one. Static analysis over the
 * plugin's PHP: custom-table index coverage, unbounded reads, COUNT misuse, and
 * N+1 queries inside loops.
 *
 * Site-type-agnostic: it keys off CREATE TABLE definitions and $wpdb usage the
 * plugin actually contains. A plugin/theme with no custom tables and no direct
 * SQL degrades to `skipped` - absence of the surface is not a defect.
 *
 * ponytail: regex SQL parser, not a full AST. Precision-over-recall - only
 * tables it found a CREATE TABLE for are index-checked, and ambiguous SQL is
 * skipped rather than guessed. Upgrade path: emit SQL/CREATE-TABLE/loop facts
 * from php-ast/extract-graph.php (roadmap S0a) and consume them here.
 */
import type { CheckerResult, PluginManifest } from './types.js';
export declare function checkScale(manifest: PluginManifest): CheckerResult;
