import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { resolveScanScope } from './scope.js';
import { fingerprintFiles } from './fingerprint.js';
import { emptyGraph, readGraph } from './graph.js';
import { ingestPhpFacts } from './php-graph.js';
import { addRestRoutes, addJsConsumers } from './rest-shapes.js';
import { findPhpFiles } from '../shared-utils.js';
const here = dirname(fileURLToPath(import.meta.url));
// build/flow -> repo root -> php-ast/extract-graph.php
const SIDECAR = join(here, '..', '..', 'php-ast', 'extract-graph.php');
/** Determine if a path is a plain file (not a directory). */
function isFile(p) {
    try {
        return statSync(p).isFile();
    }
    catch {
        return false;
    }
}
/** Determine if a path is a directory. */
function isDir(p) {
    try {
        return statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Run the PHP-AST sidecar over a mixed list of directories and PHP files.
 * Adjustment A: pass -d display_errors=0 -d display_startup_errors=0 to suppress
 *               PHP extension-load warnings that would corrupt JSON stdout.
 * Adjustment C: only pass dirs and .php files — skip non-PHP files like theme.json.
 */
function runSidecar(entries, repoRoot) {
    const sidecarArgs = entries.filter(e => isDir(e) || (isFile(e) && e.endsWith('.php')));
    if (sidecarArgs.length === 0) {
        return { symbols: [], calls: [], registrations: [], serviceBindings: [],
            hooksFired: [], templatesLoaded: [], errors: [] };
    }
    const rootArgs = repoRoot ? [`--root=${repoRoot}`] : [];
    const out = execFileSync('php', ['-d', 'display_errors=0', '-d', 'display_startup_errors=0', SIDECAR, ...rootArgs, ...sidecarArgs], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const jsonStart = out.indexOf('{');
    if (jsonStart === -1)
        throw new Error(`PHP sidecar produced no JSON. Raw head:\n${out.slice(0, 500)}`);
    return JSON.parse(out.slice(jsonStart));
}
/**
 * Collect all PHP files from a mixed list of scope entries.
 * Adjustment B: for dirs use findPhpFiles(); for individual .php files push directly.
 */
function collectPhpFiles(scopeEntries) {
    const files = [];
    for (const entry of scopeEntries) {
        if (isDir(entry)) {
            files.push(...findPhpFiles(entry));
        }
        else if (isFile(entry) && entry.endsWith('.php')) {
            files.push(entry);
        }
    }
    return files;
}
export function buildGraph(opts) {
    const g = emptyGraph({ free: opts.freeRoot, pro: opts.proRoot }, opts.generated);
    const repos = [['free', opts.freeRoot]];
    if (opts.proRoot)
        repos.push(['pro', opts.proRoot]);
    for (const [repo, root] of repos) {
        const { includeDirs } = resolveScanScope(root);
        // Ingest PHP facts from both dirs and top-level .php files.
        ingestPhpFacts(g, runSidecar(includeDirs, root), repo);
        // Add REST routes from audit/manifest.json and JS consumers from assets/.
        addRestRoutes(g, root, repo);
        addJsConsumers(g, root, repo);
        // Fingerprint all PHP files (dirs + individual files) relative to repo root.
        const phpFiles = collectPhpFiles(includeDirs);
        Object.assign(g.fingerprints, fingerprintFiles(phpFiles, root));
    }
    return g;
}
export function buildOrUpdate(opts) {
    const prior = readGraph(join(opts.freeRoot, 'audit', 'flow.json'));
    if (prior) {
        const next = fingerprintFilesForRepos(opts);
        const changed = Object.entries(next).some(([k, v]) => prior.fingerprints[k] !== v)
            || Object.keys(prior.fingerprints).some(k => !(k in next));
        if (!changed)
            return prior; // nothing changed — reuse cached graph
    }
    return buildGraph(opts);
}
function fingerprintFilesForRepos(opts) {
    const all = {};
    const roots = [opts.freeRoot, ...(opts.proRoot ? [opts.proRoot] : [])];
    for (const root of roots) {
        const { includeDirs } = resolveScanScope(root);
        const files = collectPhpFiles(includeDirs);
        Object.assign(all, fingerprintFiles(files, root));
    }
    return all;
}
//# sourceMappingURL=build.js.map