/**
 * WP Plugin QA MCP Server - Report Builder (v2.1.0)
 * Aggregates checker results into graded product evaluation report (A+ through F, 0-100).
 * 10-tier grading: A+, A, A-, B+, B, B-, C+, C, C-, D, F
 * Note: Pure data aggregation, no shell commands used.
 */
import type { CheckerResult, QaReport, AuditReport, GapAnalysisResult } from './types.js';
export declare function buildReport(pluginName: string, pluginVersion: string, results: CheckerResult[]): QaReport;
export declare function formatReport(report: QaReport): string;
/**
 * Export report as structured JSON (machine-readable, for dashboards/APIs).
 */
export declare function exportJson(report: QaReport): string;
/**
 * Export report as SARIF v2.1.0 (for GitHub Code Scanning, VS Code SARIF Viewer).
 * See: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
export declare function exportSarif(report: QaReport): string;
/**
 * Export report as JUnit XML (for CI/CD pipelines: Jenkins, GitHub Actions, CircleCI).
 */
export declare function exportJunit(report: QaReport): string;
/**
 * Build a unified audit report combining gap analysis + code quality checks.
 */
export declare function buildAuditReport(gapResult: GapAnalysisResult, qaReport: QaReport): AuditReport;
/**
 * Format the unified audit report as markdown.
 */
export declare function formatAuditReport(audit: AuditReport): string;
