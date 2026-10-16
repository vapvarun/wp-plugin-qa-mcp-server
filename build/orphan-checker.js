import { inbound } from './flow/graph.js';
// Framework-convention entrypoints (e.g. register/boot): assumed consumed by the host even without a graph edge. Trade-off: a coincidentally-named dead method is not flagged.
const SELF_USED = new Set(['__construct', '__invoke', '__destruct', 'register', 'boot']);
export function checkOrphans(g) {
    const start = Date.now();
    const issues = [];
    const targets = Object.values(g.nodes).filter(n => n.kind === 'function' || n.kind === 'method' || n.kind === 'template');
    // Build a set of referenced short names from the sidecar-emitted floor (suppresses false alarms
    // from [$this,'method'] callbacks, dynamic $obj->method(), REST/AJAX handlers, etc.)
    const refNames = new Set(g.referencedNames ?? []);
    const candidates = [];
    for (const n of targets) {
        const short = n.meta?.short ?? '';
        // Skip synthetic graph nodes (<global>, <loader>)
        if (n.name.startsWith('<') || short.startsWith('<'))
            continue;
        if (n.meta?.abstract)
            continue;
        if (n.kind === 'method' && SELF_USED.has(short))
            continue;
        const consumed = inbound(g, n.id, ['calls', 'registers', 'loads', 'reads']).length > 0;
        if (consumed)
            continue;
        // Name-reference floor: if the short name appears anywhere as a call target or callback string,
        // suppress the finding to avoid false "dead code" alarms.
        if (short && refNames.has(short))
            continue;
        candidates.push(n.name);
    }
    if (candidates.length > 0) {
        const first40 = candidates.slice(0, 40);
        const rest = candidates.length - first40.length;
        const candidateList = rest > 0
            ? `${first40.join(', ')} +${rest} more`
            : first40.join(', ');
        issues.push({
            id: 'orphan:summary', category: 'orphan', severity: 'low', type: 'info',
            title: `${candidates.length} symbols are unreferenced within the codebase (dead-code is not statically confirmable)`,
            message: `These functions/methods have no static call/registration/load and no name reference. This is NOT a confirmed dead-code list — PHP dynamic dispatch ($this->{$var}(), call_user_func, variable hooks) and external consumers (themes/app/other plugins) are invisible to static analysis, so the list contains both real dead code and live code. Confirm with runtime coverage before removing. Candidates (first 40): ${candidateList}.`,
            file: '', line: 0, code: 'orphan-summary',
            fix: `Do not bulk-delete. Confirm each against a seeded runtime/coverage run; remove only those proven unexecuted.`,
        });
    }
    return { category: 'orphan', issues, passed: Math.max(0, targets.length - candidates.length), failed: 0, skipped: 0, duration: Date.now() - start };
}
//# sourceMappingURL=orphan-checker.js.map