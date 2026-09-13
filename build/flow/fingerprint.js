import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relativePath } from '../shared-utils.js';
export function fingerprintFiles(files, repoRoot) {
    const out = {};
    for (const f of files) {
        const rel = relativePath(f, repoRoot);
        let content = '';
        try {
            content = readFileSync(f, 'utf8');
        }
        catch {
            continue;
        }
        out[rel] = createHash('sha1').update(rel + '\0' + content).digest('hex');
    }
    return out;
}
export function diffFingerprints(prev, next) {
    const changed = [];
    for (const [rel, h] of Object.entries(next))
        if (prev[rel] !== h)
            changed.push(rel);
    const deleted = [];
    for (const rel of Object.keys(prev))
        if (!(rel in next))
            deleted.push(rel);
    return { changed, deleted };
}
//# sourceMappingURL=fingerprint.js.map