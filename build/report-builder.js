/**
 * WP Plugin QA MCP Server - Report Builder (v2.1.0)
 * Aggregates checker results into graded product evaluation report (A+ through F, 0-100).
 * 10-tier grading: A+, A, A-, B+, B, B-, C+, C, C-, D, F
 * Note: Pure data aggregation, no shell commands used.
 */
const CATEGORY_WEIGHTS = {
    'smoke': 10,
    'functionality': 10,
    'api': 10,
    'database': 8,
    'browser': 5,
    'ux': 12,
    'templates': 5,
    'a11y': 10,
    'admin-eval': 12,
    'frontend-eval': 10,
    'marketing': 8,
};
export function buildReport(pluginName, pluginVersion, results) {
    const categories = [];
    const bugs = [];
    let bugIndex = 1;
    for (const result of results) {
        const total = result.passed + result.failed + result.skipped;
        const denominator = result.passed + result.failed;
        const score = denominator > 0 ? Math.round((result.passed / denominator) * 100) : 0;
        categories.push({
            category: result.category,
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
                    category: issue.category,
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
function calculateWeightedScore(categories) {
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
function scoreToGrade(score) {
    if (score >= 95)
        return 'A+';
    if (score >= 90)
        return 'A';
    if (score >= 85)
        return 'A-';
    if (score >= 80)
        return 'B+';
    if (score >= 75)
        return 'B';
    if (score >= 70)
        return 'B-';
    if (score >= 65)
        return 'C+';
    if (score >= 60)
        return 'C';
    if (score >= 55)
        return 'C-';
    if (score >= 40)
        return 'D';
    return 'F';
}
function severityOrder(severity) {
    switch (severity) {
        case 'critical': return 0;
        case 'high': return 1;
        case 'medium': return 2;
        case 'low': return 3;
        default: return 4;
    }
}
export function formatReport(report) {
    const lines = [];
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
            if (bug.file)
                lines.push(`- **File**: ${bug.file}${bug.line > 0 ? ':' + bug.line : ''}`);
            lines.push(`- **Issue**: ${bug.actual}`);
            if (bug.fix)
                lines.push(`- **Fix**: ${bug.fix}`);
            lines.push('');
        }
    }
    lines.push(`---`);
    lines.push(`Total: ${report.summary.totalTests} tests | ${report.summary.passed} passed | ${report.summary.failed} failed | ${report.summary.skipped} skipped`);
    return lines.join('\n');
}
/**
 * Export report as structured JSON (machine-readable, for dashboards/APIs).
 */
export function exportJson(report) {
    return JSON.stringify(report, null, 2);
}
/**
 * Export report as SARIF v2.1.0 (for GitHub Code Scanning, VS Code SARIF Viewer).
 * See: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
export function exportSarif(report) {
    const rules = report.bugs.map((bug, i) => ({
        id: bug.id,
        name: bug.title.replace(/[^a-zA-Z0-9]/g, ''),
        shortDescription: { text: bug.title },
        fullDescription: { text: bug.actual || bug.title },
        defaultConfiguration: {
            level: sarifLevel(bug.severity),
        },
        properties: {
            tags: [bug.category, bug.severity],
        },
    }));
    const results = report.bugs.map(bug => ({
        ruleId: bug.id,
        level: sarifLevel(bug.severity),
        message: { text: bug.actual || bug.title },
        locations: bug.file ? [{
                physicalLocation: {
                    artifactLocation: { uri: bug.file },
                    region: bug.line > 0 ? { startLine: bug.line } : undefined,
                },
            }] : [],
        fixes: bug.fix ? [{
                description: { text: bug.fix },
            }] : [],
    }));
    const sarif = {
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [{
                tool: {
                    driver: {
                        name: 'wp-plugin-qa',
                        version: '2.1.0',
                        informationUri: 'https://github.com/wbcomdesigns/wp-plugin-qa-mcp-server',
                        rules,
                    },
                },
                results,
                invocations: [{
                        executionSuccessful: true,
                        endTimeUtc: report.testedAt,
                    }],
            }],
    };
    return JSON.stringify(sarif, null, 2);
}
/**
 * Export report as JUnit XML (for CI/CD pipelines: Jenkins, GitHub Actions, CircleCI).
 */
export function exportJunit(report) {
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    const totalTests = report.summary.totalTests;
    const failures = report.summary.failed;
    const skipped = report.summary.skipped;
    const time = 0; // aggregate time not tracked
    lines.push(`<testsuites name="wp-plugin-qa: ${escapeXml(report.pluginName)}" tests="${totalTests}" failures="${failures}" skipped="${skipped}" time="${time}">`);
    for (const cat of report.categories) {
        lines.push(`  <testsuite name="${escapeXml(cat.category)}" tests="${cat.total}" failures="${cat.fail}" skipped="${cat.skip}">`);
        // Add passed tests as passing test cases
        for (let i = 0; i < cat.pass; i++) {
            lines.push(`    <testcase name="${escapeXml(cat.category)}-pass-${i + 1}" classname="wp-plugin-qa.${escapeXml(cat.category)}" />`);
        }
        // Add failed tests with failure messages
        const catBugs = report.bugs.filter(b => b.category === cat.category);
        for (const bug of catBugs) {
            lines.push(`    <testcase name="${escapeXml(bug.id)}: ${escapeXml(bug.title)}" classname="wp-plugin-qa.${escapeXml(cat.category)}">`);
            lines.push(`      <failure message="${escapeXml(bug.actual || bug.title)}" type="${escapeXml(bug.severity)}">`);
            if (bug.file)
                lines.push(`File: ${escapeXml(bug.file)}${bug.line > 0 ? ':' + bug.line : ''}`);
            if (bug.fix)
                lines.push(`Fix: ${escapeXml(bug.fix)}`);
            lines.push(`      </failure>`);
            lines.push(`    </testcase>`);
        }
        lines.push(`  </testsuite>`);
    }
    lines.push('</testsuites>');
    return lines.join('\n');
}
function sarifLevel(severity) {
    switch (severity) {
        case 'critical': return 'error';
        case 'high': return 'error';
        case 'medium': return 'warning';
        default: return 'note';
    }
}
function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
// ─── Unified Audit Report ─────────────────────────────────────────
/**
 * Build a unified audit report combining gap analysis + code quality checks.
 */
export function buildAuditReport(gapResult, qaReport) {
    // Derive action items from gaps + bugs
    const critical = [];
    const important = [];
    const recommended = [];
    // From gap analysis
    for (const gap of gapResult.gaps) {
        const item = `[GAP] ${gap.finding} — ${gap.recommendation}`;
        if (gap.priority === 'critical')
            critical.push(item);
        else if (gap.priority === 'important')
            important.push(item);
        else
            recommended.push(item);
    }
    // From code quality bugs
    for (const bug of qaReport.bugs) {
        const item = `[${bug.category}] ${bug.title}${bug.fix ? ' — ' + bug.fix : ''}`;
        if (bug.severity === 'critical')
            critical.push(item);
        else if (bug.severity === 'high')
            important.push(item);
        else
            recommended.push(item);
    }
    return {
        pluginName: gapResult.pluginName,
        pluginVersion: gapResult.pluginVersion,
        auditedAt: new Date().toISOString(),
        inventory: gapResult.inventory,
        maturity: gapResult.maturity,
        overallMaturity: gapResult.overallMaturity,
        overallMaturityScore: gapResult.overallMaturityScore,
        gapAnalysis: gapResult.gaps,
        codeQuality: {
            grade: qaReport.grade,
            score: qaReport.score,
            categories: qaReport.categories,
            bugs: qaReport.bugs,
            summary: qaReport.summary,
        },
        actionItems: { critical, important, recommended },
    };
}
/**
 * Format the unified audit report as markdown.
 */
export function formatAuditReport(audit) {
    const lines = [];
    // Header
    lines.push(`# Plugin Audit: ${audit.pluginName} v${audit.pluginVersion}`);
    lines.push(`Audited: ${audit.auditedAt.split('T')[0]}  |  Maturity: ${audit.overallMaturity.toUpperCase()} (${audit.overallMaturityScore}/100)  |  Code Quality: ${audit.codeQuality.grade} (${audit.codeQuality.score}/100)`);
    lines.push('');
    // Quick summary
    const totalActions = audit.actionItems.critical.length + audit.actionItems.important.length + audit.actionItems.recommended.length;
    lines.push('## At a Glance');
    lines.push(`- **${audit.actionItems.critical.length}** critical items to fix before release`);
    lines.push(`- **${audit.actionItems.important.length}** important items to address`);
    lines.push(`- **${audit.actionItems.recommended.length}** recommended improvements`);
    lines.push(`- **${audit.codeQuality.summary.totalTests}** code quality checks run (${audit.codeQuality.summary.passed} passed, ${audit.codeQuality.summary.failed} failed)`);
    lines.push('');
    // Inventory
    lines.push('## Plugin Inventory');
    const inv = audit.inventory;
    const invTable = [
        ['Feature', 'Count'],
        ['Custom Post Types', String(inv.cpts)],
        ['Taxonomies', String(inv.taxonomies)],
        ['REST Routes', String(inv.restRoutes)],
        ['AJAX Handlers', String(inv.ajaxHandlers)],
        ['Blocks', String(inv.blocks)],
        ['Shortcodes', String(inv.shortcodes)],
        ['Admin Pages', String(inv.adminPages)],
        ['Settings', String(inv.settings)],
        ['Widgets', String(inv.widgets)],
        ['Meta Boxes', String(inv.metaBoxes)],
        ['Cron Jobs', String(inv.cronJobs)],
        ['CLI Commands', String(inv.cliCommands)],
        ['DB Tables', String(inv.dbTables)],
        ['Templates', String(inv.templates)],
        ['Hooks Provided', String(inv.hooksProvided)],
        ['Hooks Consumed', String(inv.hooksConsumed)],
        ['Custom Roles', String(inv.customRoles)],
        ['Integrations', String(inv.integrations)],
    ].filter(row => row[0] === 'Feature' || parseInt(row[1]) > 0);
    lines.push('| Feature | Count |');
    lines.push('|---------|-------|');
    for (const row of invTable.slice(1)) {
        lines.push(`| ${row[0]} | ${row[1]} |`);
    }
    lines.push('');
    // Maturity
    lines.push('## Feature Maturity');
    lines.push('| Area | Level | Score | Details |');
    lines.push('|------|-------|-------|---------|');
    for (const m of audit.maturity) {
        lines.push(`| ${m.area} | ${m.level} | ${m.score}/100 | ${m.details} |`);
    }
    lines.push('');
    // What's Missing (Gap Analysis)
    if (audit.gapAnalysis.length > 0) {
        lines.push(`## What's Missing (${audit.gapAnalysis.length} gaps)`);
        const criticalGaps = audit.gapAnalysis.filter(g => g.priority === 'critical');
        const importantGaps = audit.gapAnalysis.filter(g => g.priority === 'important');
        const otherGaps = audit.gapAnalysis.filter(g => g.priority !== 'critical' && g.priority !== 'important');
        if (criticalGaps.length > 0) {
            lines.push('');
            lines.push('### Critical Gaps');
            for (const gap of criticalGaps) {
                lines.push(`- **${gap.finding}** (${gap.effort} effort)`);
                lines.push(`  Because: ${gap.trigger} | Fix: ${gap.recommendation}`);
            }
        }
        if (importantGaps.length > 0) {
            lines.push('');
            lines.push('### Important Gaps');
            for (const gap of importantGaps) {
                lines.push(`- **${gap.finding}** (${gap.effort} effort)`);
                lines.push(`  Fix: ${gap.recommendation}`);
            }
        }
        if (otherGaps.length > 0) {
            lines.push('');
            lines.push('### Other Gaps');
            for (const gap of otherGaps) {
                lines.push(`- ${gap.finding} (${gap.effort} effort)`);
            }
        }
        lines.push('');
    }
    // Code Quality
    lines.push(`## Code Quality: ${audit.codeQuality.grade} (${audit.codeQuality.score}/100)`);
    lines.push('| Category | Total | Pass | Fail | Score |');
    lines.push('|----------|-------|------|------|-------|');
    for (const cat of audit.codeQuality.categories) {
        lines.push(`| ${cat.category} | ${cat.total} | ${cat.pass} | ${cat.fail} | ${cat.score}% |`);
    }
    lines.push('');
    // Top bugs
    const topBugs = audit.codeQuality.bugs.slice(0, 20);
    if (topBugs.length > 0) {
        lines.push(`### Top Issues (${audit.codeQuality.bugs.length} total)`);
        for (const bug of topBugs) {
            lines.push(`- [${bug.severity}] **${bug.title}**`);
            if (bug.file)
                lines.push(`  File: ${bug.file}${bug.line > 0 ? ':' + bug.line : ''}`);
            if (bug.fix)
                lines.push(`  Fix: ${bug.fix}`);
        }
        if (audit.codeQuality.bugs.length > 20) {
            lines.push(`  ... and ${audit.codeQuality.bugs.length - 20} more`);
        }
        lines.push('');
    }
    // Action Items (combined from gaps + bugs)
    lines.push('## Action Items');
    if (audit.actionItems.critical.length > 0) {
        lines.push('');
        lines.push('### Fix Before Release');
        for (const item of audit.actionItems.critical) {
            lines.push(`- ${item}`);
        }
    }
    if (audit.actionItems.important.length > 0) {
        lines.push('');
        lines.push('### Should Fix');
        for (const item of audit.actionItems.important) {
            lines.push(`- ${item}`);
        }
    }
    if (audit.actionItems.recommended.length > 0) {
        lines.push('');
        lines.push('### Recommended');
        for (const item of audit.actionItems.recommended.slice(0, 15)) {
            lines.push(`- ${item}`);
        }
        if (audit.actionItems.recommended.length > 15) {
            lines.push(`  ... and ${audit.actionItems.recommended.length - 15} more`);
        }
    }
    lines.push('');
    lines.push('---');
    lines.push(`Total: ${audit.codeQuality.summary.totalTests} code checks | ${audit.gapAnalysis.length} gaps found | ${totalActions} action items`);
    return lines.join('\n');
}
//# sourceMappingURL=report-builder.js.map