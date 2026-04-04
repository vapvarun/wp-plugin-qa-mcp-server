/**
 * WP Plugin QA MCP Server - Gap Analyzer
 * Rules engine that evaluates a PluginManifest to find what's missing.
 * Conditional rules: "if you have X, you should also have Y"
 * Unconditional rules: "every plugin should have Z"
 * Returns structured gap findings + maturity scoring per feature area.
 */
import type { PluginManifest, GapAnalysisResult } from './types.js';
export declare function analyzeGaps(manifest: PluginManifest): GapAnalysisResult;
export declare function formatGapAnalysis(result: GapAnalysisResult): string;
