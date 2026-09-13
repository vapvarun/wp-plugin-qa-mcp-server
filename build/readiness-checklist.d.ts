/**
 * WP Plugin QA MCP Server - Readiness Scorecard ("the bar")
 *
 * Autonomous: point it at any plugin and it reports what's PRESENT, what's
 * MISSING, and what's FAILING against one portfolio standard — no need to know
 * which individual check to run. It folds the cross-layer checks (template
 * contract / zero-logic) and manifest signals together with a presence-based
 * standards bar (CI, tests, docs, QA artifacts), grouped, with an overall
 * score and a meets/below-bar verdict.
 *
 * The bar is config-driven: a plugin (or the portfolio) can override which
 * items are REQUIRED via audit/readiness-bar.json, so the team can "set the
 * bar" once and hold every plugin to it.
 */
import type { PluginManifest } from './types.js';
export type ItemStatus = 'pass' | 'missing' | 'fail' | 'n/a';
export interface ReadinessItem {
    id: string;
    group: string;
    label: string;
    required: boolean;
    status: ItemStatus;
    detail: string;
}
export interface ReadinessScorecard {
    score: number;
    requiredMet: boolean;
    barVerdict: 'meets-bar' | 'below-bar';
    counts: {
        pass: number;
        missing: number;
        fail: number;
        na: number;
    };
    groups: Record<string, {
        pass: number;
        total: number;
    }>;
    items: ReadinessItem[];
}
export declare function assessReadiness(pluginPath: string, manifest: PluginManifest): ReadinessScorecard;
/** Find plugin dirs: the root itself if it's a plugin, else its immediate subdirs. */
export declare function discoverPlugins(root: string): string[];
export interface PortfolioRow {
    name: string;
    path: string;
    score: number;
    barVerdict: 'meets-bar' | 'below-bar';
    requiredGaps: string[];
}
/** Score every plugin under the given paths/roots; worst-first. */
export declare function assessReadinessPortfolio(pluginPaths: string[]): PortfolioRow[];
export declare function formatPortfolio(rows: PortfolioRow[]): string;
/** Human-readable checklist for the wppqa_readiness tool. */
export declare function formatReadiness(sc: ReadinessScorecard, name: string): string;
