import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNode, addEdge, nodeId } from './graph.js';
import { findJsFiles, fileExists, getLineNumber } from '../shared-utils.js';
import type { FlowGraph } from '../types.js';

// Pure: maps WP REST method constants to HTTP verbs.
// READABLE→GET, CREATABLE→POST, EDITABLE→POST, DELETABLE→DELETE, ALLMETHODS→GET.
// If raw already contains a comma (e.g. 'POST, PUT, PATCH') returns the first verb.
// Otherwise returns raw unchanged (already-a-verb pass-through).
export function normalizeMethod(raw: string): string {
  if (raw.includes(',')) return raw.split(',')[0].trim();
  switch (raw) {
    case 'READABLE':   return 'GET';
    case 'CREATABLE':  return 'POST';
    case 'EDITABLE':   return 'POST';
    case 'DELETABLE':  return 'DELETE';
    case 'ALLMETHODS': return 'GET';
    default:           return raw;
  }
}

// Pure: literal response-shape keys from a handler's PHP source.
// When rest_ensure_response( is present in the source, only keys from those
// calls are extracted — bare `return array(...)` statements in the same file
// (helper methods, schema callbacks, etc.) are ignored to avoid pollution.
// Falls back to bare `return array(...)` only when rest_ensure_response is
// absent entirely.
export function extractShapeKeys(php: string): string[] {
  const keys = new Set<string>();
  const hasEnsure = php.includes('rest_ensure_response(');
  const blocks = hasEnsure
    ? [...php.matchAll(/rest_ensure_response\s*\(\s*(?:array\s*\(|\[)([\s\S]*?)(?:\)|\])\s*\)/g)]
    : [...php.matchAll(/return\s+(?:array\s*\(|\[)([\s\S]*?)(?:\)|\]);/g)];
  for (const b of blocks)
    for (const k of b[1].matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*=>/g)) keys.add(k[1]);
  return [...keys];
}

// Best-effort: matches any obj.prop near the route URL (not only the response
// variable), so Task 10 must treat broken-read findings as candidates to verify,
// not certainties.
export function extractJsReads(js: string, routeUrl: string): string[] {
  const idx = js.indexOf(routeUrl);
  if (idx < 0) return [];
  const start = Math.max(0, idx - 2000), end = Math.min(js.length, idx + 4000);
  const segment = js.slice(start, end);
  const noise = new Set([
    // existing
    'then', 'json', 'catch', 'map', 'forEach', 'length', 'data', 'error', 'message', 'code',
    // fetch / Response
    'status', 'statusText', 'ok', 'headers', 'text', 'blob',
    // event
    'target', 'currentTarget', 'preventDefault', 'stopPropagation',
    // element / DOM
    'value', 'name', 'id', 'style', 'classList', 'dataset', 'textContent', 'innerHTML',
    'getAttribute', 'setAttribute', 'querySelector', 'querySelectorAll',
    'addEventListener', 'removeEventListener',
    'parentNode', 'children', 'closest', 'append', 'remove', 'focus', 'blur',
    // Math
    'floor', 'ceil', 'round', 'abs',
    // Object / Array
    'keys', 'values', 'entries', 'from',
    'push', 'pop', 'shift', 'slice', 'splice', 'filter', 'find',
    'includes', 'indexOf', 'join', 'split', 'trim',
    'toString', 'hasOwnProperty',
    // Promise
    'resolve', 'reject', 'all',
    // console
    'log', 'warn',
  ]);
  const props = new Set<string>();
  for (const m of segment.matchAll(/\b[a-zA-Z_$][\w$]*\.([a-zA-Z_][\w]*)\b/g)) {
    if (!noise.has(m[1])) props.add(m[1]);
  }
  return [...props];
}

export function addRestRoutes(g: FlowGraph, repoRoot: string, repo: 'free'|'pro'): void {
  const manifest = join(repoRoot, 'audit', 'manifest.json');
  if (!fileExists(manifest)) return;
  let m: any; try { m = JSON.parse(readFileSync(manifest, 'utf8')); } catch { return; }
  for (const ep of m?.rest?.endpoints ?? []) {
    const method = normalizeMethod(ep.methods?.[0] ?? 'GET');
    const id = nodeId('route', `${method} ${ep.route}`);
    let shapeKeys: string[] = []; let unresolved = true;
    const file = (ep.file ?? '').split(':')[0];
    if (file && fileExists(join(repoRoot, file))) {
      const keys = extractShapeKeys(readFileSync(join(repoRoot, file), 'utf8'));
      if (keys.length) { shapeKeys = keys; unresolved = false; }
    }
    addNode(g, { id, kind: 'route', name: `${method} ${ep.route}`, file, line: 0, repo,
      meta: { shapeKeys, shapeUnresolved: unresolved, gatedBy: ep.gated_by ?? null } });
  }
}

export function addJsConsumers(g: FlowGraph, repoRoot: string, repo: 'free'|'pro'): void {
  const routes = Object.values(g.nodes).filter(n => n.kind === 'route');
  for (const f of findJsFiles(join(repoRoot, 'assets'))) {
    let js = ''; try { js = readFileSync(f, 'utf8'); } catch { continue; }
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
