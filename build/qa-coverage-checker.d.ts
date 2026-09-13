/**
 * Manifest-driven QA coverage gate (TypeScript port of bin/qa-coverage-check.php).
 *
 * Reads `audit/manifest.json` and asserts every tracked manifest category
 * has corresponding functional test coverage. Writes `audit/qa-coverage.json`
 * with per-item covered/uncovered detail + drift summary.
 *
 * Same baseline-shrink discipline as phpstan-baseline.neon: the uncovered
 * count can drop, never grow. Marks the result as `failed` when uncovered_total
 * regressed vs the previous run.
 *
 * Plugin-agnostic. No child processes used.
 */
import { CheckerResult } from './types.js';
export interface QaCoverageOptions {
    /** Treat any uncovered as a failure (default false — only regressions fail). */
    strict?: boolean;
    /** Skip writing audit/qa-coverage.json (read-only mode). */
    dryRun?: boolean;
}
export declare function checkQaCoverage(pluginPath: string, options?: QaCoverageOptions): CheckerResult;
