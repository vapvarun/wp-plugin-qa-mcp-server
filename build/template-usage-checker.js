import { join, basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { inbound } from './flow/graph.js';
import { findPhpFiles, findJsFiles, relativePath, dirExists } from './shared-utils.js';
// Entrypoint = a top-level page template or a route-folder home, loaded by the router/WP directly.
const PARTS_DIRS = ['/parts/', '/partials/', '/blocks/'];
export function isEntrypoint(rel) {
    if (PARTS_DIRS.some(d => rel.includes(d)))
        return false;
    const inTemplates = rel.replace(/^.*templates\//, '');
    return inTemplates.split('/').length <= 2; // templates/foo.php or templates/route/home.php
}
// Scan all PHP+JS source in the given repo roots and build a SourceIndex.
// Called once per checkTemplateUsage invocation.
function buildSourceIndex(repoRoots) {
    const literals = new Set();
    const requirePaths = new Set();
    // Matches: require/include(_once) followed by (optional whitespace, optional paren, optional __DIR__.'/', then a quoted literal)
    // e.g.  require __DIR__ . '/nav.php';   require_once( 'parts/foo.php' );
    const requireRe = /(?:require|include)(?:_once)?\s*[(\s]*(?:__DIR__\s*\.\s*)?['"]([^'"]+)['"]/g;
    const quoteRe = /['"]([^'"]+)['"]/g;
    for (const root of repoRoots) {
        const phpFiles = (() => { try {
            return findPhpFiles(root);
        }
        catch {
            return [];
        } })();
        const jsFiles = (() => { try {
            return findJsFiles(join(root, 'assets'));
        }
        catch {
            return [];
        } })();
        for (const f of [...phpFiles, ...jsFiles]) {
            let src = '';
            try {
                src = readFileSync(f, 'utf8');
            }
            catch {
                continue;
            }
            // Extract require/include literal paths first
            for (const m of src.matchAll(requireRe))
                requirePaths.add(m[1]);
            // Extract all quoted string literals
            for (const m of src.matchAll(quoteRe))
                literals.add(m[1]);
        }
    }
    return { literals, requirePaths };
}
// Returns true if the template is referenced by source code (not via graph edge).
// B.php = basename (e.g. "nav.php"), stem = "nav"
// Rule 1: B.php appears as SUBSTRING of any quoted string literal OR require/include path
// Rule 2: stem (without .php) is an EXACT match of any quoted string literal
function isReferencedInSource(nameForLoader, base, idx) {
    const stem = base.endsWith('.php') ? base.slice(0, -4) : base;
    // Rule 1: B.php as substring in quoted literals
    for (const s of idx.literals) {
        if (s.includes(base))
            return true;
    }
    // Rule 1: B.php as substring in require/include paths
    for (const p of idx.requirePaths) {
        if (p.includes(base))
            return true;
    }
    // Rule 2: stem EXACT match in quoted literals (no substring — must be the whole string)
    for (const s of idx.literals) {
        if (s === stem)
            return true;
    }
    return false;
}
export function checkTemplateUsage(g, repoRoots) {
    const start = Date.now();
    const issues = [];
    // Set of loaded template names (graph node name == relative template path passed to loader).
    const loaded = new Set(Object.values(g.nodes).filter(n => n.kind === 'template' && inbound(g, n.id, ['loads']).length > 0).map(n => n.name));
    // Build source index once across all repos.
    const idx = buildSourceIndex(repoRoots);
    const candidates = [];
    let checked = 0;
    for (const root of repoRoots) {
        const tplDir = join(root, 'templates');
        if (!dirExists(tplDir))
            continue;
        for (const f of findPhpFiles(tplDir)) {
            const rel = relativePath(f, root);
            const nameForLoader = rel.replace(/^templates\//, '');
            const base = basename(f);
            checked++;
            if (isEntrypoint(rel))
                continue;
            const isLoaded = [...loaded].some(l => l === nameForLoader || l.endsWith('/' + nameForLoader) || nameForLoader.endsWith('/' + l));
            if (!isLoaded && !isReferencedInSource(nameForLoader, base, idx)) {
                candidates.push(rel);
            }
        }
    }
    if (candidates.length > 0) {
        const MAX_LISTED = 40;
        const listed = candidates.slice(0, MAX_LISTED);
        const overflow = candidates.length - listed.length;
        const candidateList = overflow > 0
            ? `${listed.join(', ')}, +${overflow} more`
            : listed.join(', ');
        issues.push({
            id: 'tpl-usage:unloaded-summary',
            category: 'template-usage',
            severity: 'low',
            type: 'info',
            title: `${candidates.length} templates have no statically-detectable loader`,
            message: `These template parts have no buddynext_get_template/require/load-helper reference found by static scan. This is NOT a confirmed dead-template list — templates loaded by computed name (e.g. buddynext_get_template($var), "panel-{$tab}.php") are invisible to static analysis. Confirm with runtime coverage (which parts never render) before removing. Candidates (first ${MAX_LISTED}): ${candidateList}.`,
            file: candidates[0],
            line: 1,
            code: 'template-never-loaded',
            fix: `Do not bulk-delete. Confirm against a seeded runtime render before removing.`,
        });
    }
    return { category: 'template-usage', issues, passed: Math.max(0, checked - candidates.length), failed: 0, skipped: 0, duration: Date.now() - start };
}
//# sourceMappingURL=template-usage-checker.js.map