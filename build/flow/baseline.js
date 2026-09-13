import { readFileSync } from 'node:fs';
import { fileExists } from '../shared-utils.js';
export function loadBaseline(path) {
    if (!fileExists(path))
        return { suppressions: [] };
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return { suppressions: [] };
    }
}
export function applyBaseline(issues, baseline) {
    const sup = new Set(baseline.suppressions.map(s => s.id));
    return issues.filter(i => !sup.has(i.id));
}
//# sourceMappingURL=baseline.js.map