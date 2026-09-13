// SHA-1 of the empty string — empty __construct / abstract stub bodies all hash to this.
const EMPTY_BODY_HASH = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
// Bodies this short (≤ ~2-3 lines, e.g. `return true;` stubs) are trivial and
// not worth consolidating even when identical — skip the whole cluster.
const TRIVIAL_BODY = 80;
export function checkDupFunctions(g) {
    const start = Date.now();
    const byHash = new Map();
    for (const n of Object.values(g.nodes)) {
        if (n.kind !== 'function' && n.kind !== 'method')
            continue;
        const h = n.meta?.bodyHash || '';
        if (!h)
            continue;
        const arr = byHash.get(h) ?? [];
        arr.push(n);
        byHash.set(h, arr);
    }
    const issues = [];
    let clusters = 0;
    for (const [hash, members] of byHash) {
        if (members.length < 2)
            continue;
        // Skip empty-body stubs: sha1('') clusters are abstract/empty-__construct false positives.
        if (hash === EMPTY_BODY_HASH)
            continue;
        // Skip trivial stubs: every member has a short body (≤2-3 lines, e.g. `return true;`).
        if (members.every(m => (m.meta?.bodyLen ?? 0) < TRIVIAL_BODY))
            continue;
        // Exclude same-short-name method override families (legitimate Free/Pro override).
        const shorts = new Set(members.map(m => m.meta?.short));
        const allMethods = members.every(m => m.kind === 'method');
        if (allMethods && shorts.size === 1)
            continue;
        clusters++;
        issues.push({
            id: `dup:${hash}`, category: 'dup-function', severity: 'high', type: 'error',
            title: `Duplicate implementation across ${members.length} symbols`,
            message: `Identical body in: ${members.map(m => `${m.name} (${m.file}:${m.line})`).join(', ')}. Consolidate to one canonical helper.`,
            file: members[0].file, line: members[0].line, code: 'duplicate-function',
            fix: `Keep one (recommend the one in the most general location) and route the others through it.`,
        });
    }
    const checked = byHash.size;
    return { category: 'dup-function', issues, passed: Math.max(0, checked - clusters), failed: clusters, skipped: 0, duration: Date.now() - start };
}
//# sourceMappingURL=dup-function-checker.js.map