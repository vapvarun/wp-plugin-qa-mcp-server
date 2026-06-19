import { addNode, addEdge, nodeId } from './graph.js';
import type { FlowGraph } from '../types.js';

export interface PhpSymbol { kind:'function'|'method'; name:string; class:string|null; fqn:string; file:string; line:number; bodyHash:string; params:string[]; visibility:string|null; abstract:boolean; }
export interface PhpCall { fromFqn:string|null; toName:string; viaService:string|null; file:string; line:number; }
export interface PhpReg { hook:string; callback:string; mechanism:string; file:string; line:number; }
export interface PhpBind { id:string; class:string; file:string; line:number; }
export interface PhpFacts { symbols:PhpSymbol[]; calls:PhpCall[]; registrations:PhpReg[]; serviceBindings:PhpBind[]; hooksFired:{hook:string;file:string;line:number}[]; templatesLoaded:{template:string;argKeys:string[];file:string;line:number}[]; errors:{file:string;message:string}[]; }

export function ingestPhpFacts(g: FlowGraph, facts: PhpFacts, repo: 'free'|'pro'): void {
  // 1. Symbols → function/method nodes (keyed by fqn; meta carries bodyHash for dup).
  const methodByShortName = new Map<string, string[]>(); // short method name -> [fqn]
  for (const s of facts.symbols) {
    const id = nodeId(s.kind, s.fqn);
    addNode(g, { id, kind: s.kind, name: s.fqn, file: s.file, line: s.line, repo,
      meta: { bodyHash: s.bodyHash, params: s.params, class: s.class, visibility: s.visibility, abstract: s.abstract, short: s.name } });
    if (s.kind === 'method') {
      const arr = methodByShortName.get(s.name) ?? []; arr.push(s.fqn); methodByShortName.set(s.name, arr);
    }
  }
  // 2. Service bindings → service nodes + binding edge to class methods.
  const classOfService = new Map<string, string>();
  for (const b of facts.serviceBindings) {
    classOfService.set(b.id, b.class);
    addNode(g, { id: nodeId('service', b.id), kind: 'service', name: b.id, file: b.file, line: b.line, repo, meta: { class: b.class } });
  }
  // 3. Calls → calls edges. Resolve viaService to bound class method.
  for (const c of facts.calls) {
    const from = c.fromFqn ? (nodeIdForFqn(g, c.fromFqn)) : null;
    let toId: string | null = null;
    if (c.viaService) {
      const cls = classOfService.get(c.viaService);
      if (cls && c.toName) toId = nodeId('method', `${cls}::${c.toName}`);
    } else {
      // direct function call, else fall back to a unique method short-name match
      toId = nodeId('function', c.toName);
      if (!g.nodes[toId]) {
        const cands = methodByShortName.get(c.toName);
        if (cands && cands.length === 1) toId = nodeId('method', cands[0]);
      }
    }
    if (toId && g.nodes[toId]) addEdge(g, { from: from ?? toId, to: toId, kind: 'calls', file: c.file, line: c.line });
  }
  // 4. Registrations → registers edge INTO the callback symbol (consumption marker).
  for (const r of facts.registrations) {
    if (!r.callback) continue;
    const cbId = r.callback.includes('::') ? nodeId('method', r.callback) : nodeId('function', r.callback);
    addNode(g, { id: nodeId('hook', r.hook), kind: 'hook', name: r.hook, file: r.file, line: r.line, repo });
    if (g.nodes[cbId]) addEdge(g, { from: nodeId('hook', r.hook), to: cbId, kind: 'registers', file: r.file, line: r.line });
  }
  // 5. Fired hooks → fires edges from hook node (producer side).
  for (const h of facts.hooksFired) {
    addNode(g, { id: nodeId('hook', h.hook), kind: 'hook', name: h.hook, file: h.file, line: h.line, repo });
    addEdge(g, { from: nodeId('hook', h.hook), to: nodeId('hook', h.hook), kind: 'fires', file: h.file, line: h.line });
  }
  // 6. Templates loaded → template nodes + loads edges with argKeys.
  for (const t of facts.templatesLoaded) {
    const tid = nodeId('template', t.template);
    addNode(g, { id: tid, kind: 'template', name: t.template, file: t.file, line: t.line, repo, meta: {} });
    addEdge(g, { from: nodeId('function', '<loader>'), to: tid, kind: 'loads', file: t.file, line: t.line, meta: { argKeys: t.argKeys } });
  }
}

function nodeIdForFqn(g: FlowGraph, fqn: string): string {
  const m = nodeId('method', fqn);
  if (g.nodes[m]) return m;
  return nodeId('function', fqn);
}
