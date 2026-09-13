const ORDER = { error: 0, warning: 1, info: 2 };
export function renderReport(results, meta) {
    const lines = [];
    lines.push(`# Flow Audit Report`, ``, `- Generated: ${meta.generated}`, `- Repos: ${meta.repos.join(', ')}`, ``);
    const totalErr = results.reduce((a, r) => a + r.issues.filter(i => i.type === 'error').length, 0);
    const totalWarn = results.reduce((a, r) => a + r.issues.filter(i => i.type === 'warning').length, 0);
    lines.push(`**${totalErr} errors, ${totalWarn} warnings** across ${results.length} checks.`, ``);
    for (const r of results) {
        const errs = r.issues.filter(i => i.type === 'error').length;
        lines.push(`## ${r.category} — ${errs} error(s), ${r.issues.length} finding(s)`, ``);
        const sorted = [...r.issues].sort((a, b) => (ORDER[a.type] ?? 3) - (ORDER[b.type] ?? 3));
        for (const i of sorted) {
            lines.push(`- [${i.type}] **${i.title}** \`${i.file}:${i.line}\``);
            lines.push(`  - ${i.message}`);
            if (i.fix)
                lines.push(`  - _Fix:_ ${i.fix}`);
            lines.push(`  - _id:_ \`${i.id}\``);
        }
        lines.push(``);
    }
    return lines.join('\n');
}
//# sourceMappingURL=report.js.map