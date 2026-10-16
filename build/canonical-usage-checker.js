import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveScanScope } from './flow/scope.js';
import { CANONICAL_RULES } from './flow/canonical-rules.js';
import { findPhpFiles, relativePath, getLineNumber, dirExists } from './shared-utils.js';
// Strip PHP comments from content while preserving newlines (so line numbers stay accurate).
// Handles block comments, line comments (// and #).
// Respects single- and double-quoted string literals so comment-like text inside strings
// is NOT removed.
export function stripPhpComments(content) {
    let result = '';
    let i = 0;
    const len = content.length;
    while (i < len) {
        const ch = content[i];
        // Single-quoted string: pass through verbatim
        if (ch === "'") {
            result += ch;
            i++;
            while (i < len) {
                const c = content[i];
                result += c;
                i++;
                if (c === '\\') {
                    if (i < len) {
                        result += content[i];
                        i++;
                    }
                }
                else if (c === "'")
                    break;
            }
            continue;
        }
        // Double-quoted string: pass through verbatim
        if (ch === '"') {
            result += ch;
            i++;
            while (i < len) {
                const c = content[i];
                result += c;
                i++;
                if (c === '\\') {
                    if (i < len) {
                        result += content[i];
                        i++;
                    }
                }
                else if (c === '"')
                    break;
            }
            continue;
        }
        // Block comment /* ... */
        if (ch === '/' && i + 1 < len && content[i + 1] === '*') {
            i += 2;
            while (i < len) {
                if (content[i] === '\n') {
                    result += '\n';
                    i++;
                }
                else if (content[i] === '*' && i + 1 < len && content[i + 1] === '/') {
                    i += 2;
                    break;
                }
                else {
                    i++;
                }
            }
            continue;
        }
        // Line comment // ...
        if (ch === '/' && i + 1 < len && content[i + 1] === '/') {
            i += 2;
            while (i < len && content[i] !== '\n')
                i++;
            continue;
        }
        // Line comment # ...
        if (ch === '#') {
            i++;
            while (i < len && content[i] !== '\n')
                i++;
            continue;
        }
        result += ch;
        i++;
    }
    return result;
}
export function scanForRule(content, rule) {
    const lines = [];
    const re = new RegExp(rule.pattern.source, 'g');
    for (const m of content.matchAll(re))
        lines.push(getLineNumber(content, m.index ?? 0));
    return lines;
}
export function checkCanonicalUsage(repoRoots) {
    const start = Date.now();
    const issues = [];
    let scanned = 0;
    for (const root of repoRoots) {
        const { includeDirs } = resolveScanScope(root);
        const tplDir = join(root, 'templates');
        const tplFiles = dirExists(tplDir) ? findPhpFiles(tplDir) : [];
        const allPhp = [];
        for (const d of includeDirs)
            allPhp.push(...findPhpFiles(d));
        for (const f of allPhp) {
            const isTpl = tplFiles.includes(f);
            let content = '';
            try {
                content = readFileSync(f, 'utf8');
            }
            catch {
                continue;
            }
            scanned++;
            const stripped = stripPhpComments(content);
            for (const rule of CANONICAL_RULES) {
                if (rule.appliesTo === 'template' && !isTpl)
                    continue;
                if (rule.appliesTo === 'php' && isTpl)
                    continue;
                for (const line of scanForRule(stripped, rule)) {
                    const rel = relativePath(f, root);
                    issues.push({ id: `wrong-fn:${rule.id}:${rel}:${line}`, category: 'canonical-usage', severity: 'high', type: 'error',
                        title: `Wrong-layer usage: ${rule.id}`, message: rule.message, file: rel, line, code: 'canonical-usage-violation', fix: rule.fix });
                }
            }
        }
    }
    const failed = issues.length;
    return { category: 'canonical-usage', issues, passed: Math.max(0, scanned - failed), failed, skipped: 0, duration: Date.now() - start };
}
//# sourceMappingURL=canonical-usage-checker.js.map