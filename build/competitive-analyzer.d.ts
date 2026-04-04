/**
 * WP Plugin QA MCP Server - Competitive Analyzer
 * Scans plugin, searches 3 marketplaces (WordPress.org, CodeCanyon, Google),
 * compares features, and generates gap analysis + prioritized roadmap.
 */
import type { CompetitiveReport } from './types.js';
export declare function analyzeCompetitors(pluginPath: string, searchKeywords?: string, maxCompetitors?: number): Promise<CompetitiveReport>;
export declare function formatCompetitiveReport(report: CompetitiveReport): string;
