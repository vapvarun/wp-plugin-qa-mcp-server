/**
 * WP Plugin QA MCP Server - Report Builder
 * Aggregates checker results into graded QA report (A-F, 0-100).
 * Note: Pure data aggregation, no shell commands used.
 */

import type { CheckerResult, QaReport, CategoryScore, BugReport, TestCategory } from './types.js';

const CATEGORY_WEIGHTS: Record<string, number> = {
  'smoke': 20,
  'functionality': 15,
  'code-quality': 10,
  'security': 15,
  'api': 10,
  'database': 8,
  'browser': 7,
  'ux': 5,
  'templates': 3,
  'action-audit': 3,
  'compatibility': 2,
  'i18n': 1,
  'performance': 1,
};

export function buildReport(
  pluginName: string,
  pluginVersion: string,
  results: CheckerResult[],
): QaReport {
  const categories: CategoryScore[] = [];
  const bugs: BugReport[] = [];
  let bugIndex = 1;

  for (const result of results) {
    const total = result.passed + result.failed + result.skipped;
    const score = total > 0 ? Math.round((result.passed / (result.passed + result.failed)) * 100) : 100;

    categories.push({
      category: result.category as TestCategory,
      total,
      pass: result.passed,
      fail: result.failed,
      skip: result.skipped,
      score,
    });

    for (const issue of result.issues) {
      if (issue.type === 'error' || (issue.type === 'warning' && issue.severity !== 'low')) {
        bugs.push({
          id: `BUG-${String(bugIndex++).padStart(3, '0')}`,
          title: issue.title,
          severity: issue.severity,
          category: issue.category as TestCategory,
          file: issue.file,
          line: issue.line,
          steps: '',
          expected: '',
          actual: issue.message,
          fix: issue.fix,
        });
      }
    }
  }

  const overallScore = calculateWeightedScore(categories);
  const grade = scoreToGrade(overallScore);

  bugs.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  const totalTests = categories.reduce((sum, c) => sum + c.total, 0);
  const totalPassed = categories.reduce((sum, c) => sum + c.pass, 0);
  const totalFailed = categories.reduce((sum, c) => sum + c.fail, 0);
  const totalSkipped = categories.reduce((sum, c) => sum + c.skip, 0);

  return {
    pluginName,
    pluginVersion,
    grade,
    score: overallScore,
    testedAt: new Date().toISOString(),
    categories,
    bugs,
    summary: {
      totalTests,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      criticalBugs: bugs.filter(b => b.severity === 'critical').length,
      highBugs: bugs.filter(b => b.severity === 'high').length,
      mediumBugs: bugs.filter(b => b.severity === 'medium').length,
      lowBugs: bugs.filter(b => b.severity === 'low').length,
    },
  };
}

function calculateWeightedScore(categories: CategoryScore[]): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const cat of categories) {
    const weight = CATEGORY_WEIGHTS[cat.category] || 1;
    if (cat.total > 0) {
      weightedSum += cat.score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function severityOrder(severity: string): number {
  switch (severity) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
  }
}

export function formatReport(report: QaReport): string {
  const lines: string[] = [];

  lines.push(`# QA Report: ${report.pluginName} v${report.pluginVersion}`);
  lines.push(`Grade: ${report.grade} (${report.score}/100)  |  Tested: ${report.testedAt.split('T')[0]}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('| Category | Total | Pass | Fail | Score |');
  lines.push('|----------|-------|------|------|-------|');
  for (const cat of report.categories) {
    lines.push(`| ${cat.category} | ${cat.total} | ${cat.pass} | ${cat.fail} | ${cat.score}% |`);
  }
  lines.push('');

  const critical = report.bugs.filter(b => b.severity === 'critical');
  const high = report.bugs.filter(b => b.severity === 'high');
  const medium = report.bugs.filter(b => b.severity === 'medium');

  if (critical.length > 0) {
    lines.push('## Critical Bugs (fix before release)');
    for (const bug of critical) {
      lines.push(`- [${bug.id}] ${bug.title}`);
    }
    lines.push('');
  }

  if (high.length > 0) {
    lines.push('## High Priority');
    for (const bug of high) {
      lines.push(`- [${bug.id}] ${bug.title}`);
    }
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('## Medium Priority');
    for (const bug of medium) {
      lines.push(`- [${bug.id}] ${bug.title}`);
    }
    lines.push('');
  }

  if (report.bugs.length > 0) {
    lines.push('## Bug Details');
    for (const bug of report.bugs) {
      lines.push(`### ${bug.id}: ${bug.title}`);
      lines.push(`- **Severity**: ${bug.severity}`);
      lines.push(`- **Category**: ${bug.category}`);
      if (bug.file) lines.push(`- **File**: ${bug.file}${bug.line > 0 ? ':' + bug.line : ''}`);
      lines.push(`- **Issue**: ${bug.actual}`);
      if (bug.fix) lines.push(`- **Fix**: ${bug.fix}`);
      lines.push('');
    }
  }

  lines.push(`---`);
  lines.push(`Total: ${report.summary.totalTests} tests | ${report.summary.passed} passed | ${report.summary.failed} failed | ${report.summary.skipped} skipped`);

  return lines.join('\n');
}
