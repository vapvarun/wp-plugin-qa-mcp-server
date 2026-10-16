import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNode, addEdge, nodeId } from './graph.js';
import { findJsFiles, fileExists, getLineNumber } from '../shared-utils.js';
// Pure: maps WP REST method constants to HTTP verbs.
// READABLE→GET, CREATABLE→POST, EDITABLE→POST, DELETABLE→DELETE, ALLMETHODS→GET.
// If raw already contains a comma (e.g. 'POST, PUT, PATCH') returns the first verb.
// Otherwise returns raw unchanged (already-a-verb pass-through).
export function normalizeMethod(raw) {
    if (raw.includes(','))
        return raw.split(',')[0].trim();
    switch (raw) {
        case 'READABLE': return 'GET';
        case 'CREATABLE': return 'POST';
        case 'EDITABLE': return 'POST';
        case 'DELETABLE': return 'DELETE';
        case 'ALLMETHODS': return 'GET';
        default: return raw;
    }
}
// Pure: literal response-shape keys from a handler's PHP source.
// When rest_ensure_response( is present in the source, only keys from those
// calls are extracted — bare `return array(...)` statements in the same file
// (helper methods, schema callbacks, etc.) are ignored to avoid pollution.
// Falls back to bare `return array(...)` only when rest_ensure_response is
// absent entirely.
export function extractShapeKeys(php) {
    const keys = new Set();
    const hasEnsure = php.includes('rest_ensure_response(');
    const blocks = hasEnsure
        ? [...php.matchAll(/rest_ensure_response\s*\(\s*(?:array\s*\(|\[)([\s\S]*?)(?:\)|\])\s*\)/g)]
        : [...php.matchAll(/return\s+(?:array\s*\(|\[)([\s\S]*?)(?:\)|\]);/g)];
    for (const b of blocks)
        for (const k of b[1].matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*=>/g))
            keys.add(k[1]);
    return [...keys];
}
// Wrapper-key props emitted by WP REST (data/error/message/code) are response
// envelope fields, not endpoint shape keys — suppress them.
const WRAPPER_KEYS = new Set(['data', 'error', 'message', 'code']);
// Scoped: returns ONLY property reads on the JSON response binding found near
// the route URL. If no response binding is identified in the window, returns []
// rather than guessing. This trades recall for precision — no false positives
// from DOM/JS-API calls that happen to sit near the fetch.
export function extractJsReads(js, routeUrl) {
    const idx = js.indexOf(routeUrl);
    if (idx < 0)
        return [];
    const start = Math.max(0, idx - 2000), end = Math.min(js.length, idx + 4000);
    const segment = js.slice(start, end);
    // 1. Destructure pattern: .then(({a, b, c}) => ...) — keys ARE the reads.
    const destructureMatch = segment.match(/\.then\s*\(\s*\(\s*\{([^}]+)\}\s*\)/);
    if (destructureMatch) {
        const keys = destructureMatch[1]
            .split(',')
            .map(k => k.trim().replace(/:.*$/, '').trim()) // handle {key: alias}
            .filter(k => /^[a-zA-Z_][\w]*$/.test(k) && !WRAPPER_KEYS.has(k));
        return [...new Set(keys)];
    }
    // 2. Promise chain: .then(NAME => ...) or .then(function(NAME){...})
    //    — response var is NAME in the SECOND .then (after .json()).
    // 3. Await: const|let|var NAME = await <expr>.json() or = await apiFetch(...)
    //    Checked before chain so `const res = await fetch(...).then(r=>r.json())`
    //    binds to `res` (the JSON holder) not `r` (the raw Response).
    const awaitVar = resolveAwaitVar(segment);
    const chainVar = awaitVar ? null : resolveChainVar(segment);
    const responseVar = awaitVar ?? chainVar;
    if (!responseVar)
        return []; // no binding found → don't guess
    // Collect NAME.prop, NAME?.prop, NAME['prop'] on the response var.
    const props = new Set();
    const propRe = new RegExp(`\\b${escapeRe(responseVar)}(?:\\??\\.([a-zA-Z_][\\w]*)|(\\['([a-zA-Z_][\\w]*)'\\]))`, 'g');
    for (const m of segment.matchAll(propRe)) {
        const key = m[1] ?? m[3];
        if (key && !WRAPPER_KEYS.has(key))
            props.add(key);
    }
    return [...props];
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Finds the response variable name in a .then(NAME => …).then(NAME2 => …) chain.
// The JSON response is in the second .then after .json(); if only one .then exists
// and its body calls .json() inside, fall back to that .then's var.
function resolveChainVar(segment) {
    // Collect all .then(NAME => or .then(function(NAME) patterns in order.
    const thenRe = /\.then\s*\(\s*(?:function\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)|([a-zA-Z_$][\w$]*)\s*=>)/g;
    const vars = [];
    for (const m of segment.matchAll(thenRe)) {
        vars.push(m[1] ?? m[2]);
    }
    if (vars.length === 0)
        return null;
    // If ≥2 .then handlers, the second is the JSON consumer (first calls .json()).
    if (vars.length >= 2)
        return vars[1];
    // Single .then: only use it if the segment also contains .json() (it's the consumer).
    if (segment.includes('.json()'))
        return vars[0];
    return null;
}
// Finds the response variable from: const|let|var NAME = await <expr>.json()
// or const|let|var NAME = await apiFetch(...)
function resolveAwaitVar(segment) {
    const m = segment.match(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*await\s+(?:[^;]*?\.json\(\)|apiFetch\s*\()/);
    return m ? m[1] : null;
}
export function addRestRoutes(g, repoRoot, repo) {
    const manifest = join(repoRoot, 'audit', 'manifest.json');
    if (!fileExists(manifest))
        return;
    let m;
    try {
        m = JSON.parse(readFileSync(manifest, 'utf8'));
    }
    catch {
        return;
    }
    for (const ep of m?.rest?.endpoints ?? []) {
        const method = normalizeMethod(ep.methods?.[0] ?? 'GET');
        const id = nodeId('route', `${method} ${ep.route}`);
        let shapeKeys = [];
        let unresolved = true;
        const file = (ep.file ?? '').split(':')[0];
        if (file && fileExists(join(repoRoot, file))) {
            const keys = extractShapeKeys(readFileSync(join(repoRoot, file), 'utf8'));
            if (keys.length) {
                shapeKeys = keys;
                unresolved = false;
            }
        }
        addNode(g, { id, kind: 'route', name: `${method} ${ep.route}`, file, line: 0, repo,
            meta: { shapeKeys, shapeUnresolved: unresolved, gatedBy: ep.gated_by ?? null } });
    }
}
export function addJsConsumers(g, repoRoot, repo) {
    const routes = Object.values(g.nodes).filter(n => n.kind === 'route');
    for (const f of findJsFiles(join(repoRoot, 'assets'))) {
        let js = '';
        try {
            js = readFileSync(f, 'utf8');
        }
        catch {
            continue;
        }
        for (const r of routes) {
            const path = r.name.split(' ')[1];
            const reads = extractJsReads(js, path);
            for (const prop of reads) {
                const cid = nodeId('jsConsumer', `${f}:${r.name}:${prop}`);
                addNode(g, { id: cid, kind: 'jsConsumer', name: prop, file: f, line: getLineNumber(js, js.indexOf(path)), repo, meta: { prop } });
                addEdge(g, { from: cid, to: r.id, kind: 'reads', file: f, line: 0, meta: { prop } });
            }
        }
    }
}
//# sourceMappingURL=rest-shapes.js.map