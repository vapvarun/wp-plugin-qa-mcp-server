import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNode, addEdge, nodeId } from './graph.js';
import { findJsFiles, fileExists, getLineNumber } from '../shared-utils.js';
import type { FlowGraph } from '../types.js';

// Pure: literal response-shape keys from a handler's PHP source.
export function extractShapeKeys(php: string): string[] {
  const keys = new Set<string>();
  const blocks = [...php.matchAll(/rest_ensure_response\s*\(\s*(?:array\s*\(|\[)([\s\S]*?)(?:\)|\])\s*\)/g),
                  ...php.matchAll(/return\s+(?:array\s*\(|\[)([\s\S]*?)(?:\)|\]);/g)];
  for (const b of blocks)
    for (const k of b[1].matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*=>/g)) keys.add(k[1]);
  return [...keys];
}

// Pure: JS property reads (d.<prop>) within 50 lines of a route URL reference.
export function extractJsReads(js: string, routeUrl: string): string[] {
  const idx = js.indexOf(routeUrl);
  if (idx < 0) return [];
  const start = Math.max(0, idx - 2000), end = Math.min(js.length, idx + 4000);
  const window = js.slice(start, end);
  const props = new Set<string>();
  for (const m of window.matchAll(/\b[a-zA-Z_$][\w$]*\.([a-zA-Z_][\w]*)\b/g)) {
    if (!['then','json','catch','map','forEach','length','data','error','message','code'].includes(m[1])) props.add(m[1]);
  }
  return [...props];
}

export function addRestRoutes(g: FlowGraph, repoRoot: string, repo: 'free'|'pro'): void {
  const manifest = join(repoRoot, 'audit', 'manifest.json');
  if (!fileExists(manifest)) return;
  let m: any; try { m = JSON.parse(readFileSync(manifest, 'utf8')); } catch { return; }
  for (const ep of m?.rest?.endpoints ?? []) {
    const method = (ep.methods?.[0] ?? 'GET').replace('READABLE','GET').replace('CREATABLE','POST');
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
