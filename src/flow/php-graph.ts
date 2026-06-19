import { addNode, addEdge, nodeId } from './graph.js';
import type { FlowGraph } from '../types.js';

export interface PhpSymbol { kind:'function'|'method'; name:string; class:string|null; fqn:string; file:string; line:number; bodyHash:string; params:string[]; visibility:string|null; abstract:boolean; }
export interface PhpCall { fromFqn:string|null; toName:string; viaService:string|null; file:string; line:number; }
export interface PhpReg { hook:string; callback:string; mechanism:string; file:string; line:number; }
export interface PhpBind { id:string; class:string; file:string; line:number; }
export interface PhpFacts { symbols:PhpSymbol[]; calls:PhpCall[]; registrations:PhpReg[]; serviceBindings:PhpBind[]; hooksFired:{hook:string;file:string;line:number}[]; templatesLoaded:{template:string;argKeys:string[];file:string;line:number}[]; errors:{file:string;message:string}[]; referencedNames?:string[]; }

export function ingestPhpFacts(g: FlowGraph, facts: PhpFacts, repo: 'free'|'pro'): void {
  // 0. Merge referencedNames from sidecar into graph (deduplicated union).
  if (facts.referencedNames && facts.referencedNames.length > 0) {
    const existing = new Set(g.referencedNames ?? []);
    for (const n of facts.referencedNames) existing.add(n);
    g.referencedNames = Array.from(existing).sort();
  }
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
  // Fix 1: when fromFqn is null (call from file top-level / global scope), use a synthetic <global>
  // node rather than falling back to toId which produces a meaningless self-loop.
  const globalId = nodeId('function', '<global>');
  addNode(g, { id: globalId, kind: 'function', name: '<global>', file: '', line: 0, repo, meta: { synthetic: true } });
  for (const c of facts.calls) {
    const from = c.fromFqn ? nodeIdForFqn(g, c.fromFqn) : globalId;
    let toId: string | null = null;
    if (c.viaService) {
      const cls = classOfService.get(c.viaService);
      if (cls && c.toName) toId = nodeId('method', `${cls}::${c.toName}`);
    } else if (c.toName.includes('::')) {
      // FQN-qualified method call (e.g. from $this->m(), self::m(), Class::m() after name resolution)
      const candidate = nodeId('method', c.toName);
      if (g.nodes[candidate]) toId = candidate;
    } else {
      // direct function call, else fall back to a unique method short-name match
      toId = nodeId('function', c.toName);
      if (!g.nodes[toId]) {
        const cands = methodByShortName.get(c.toName);
        if (cands && cands.length === 1) toId = nodeId('method', cands[0]);
      }
    }
    if (toId && g.nodes[toId] && from !== toId) addEdge(g, { from, to: toId, kind: 'calls', file: c.file, line: c.line });
  }
  // 4. Registrations → registers edge INTO the callback symbol (consumption marker).
  // Precision gap: if the registered callback is a closure or a symbol defined outside the
  // scanned file set (e.g. a third-party lib or vendor path), the sidecar returns the raw
  // callback string but no matching node exists in `g.nodes`, so no `registers` edge is
  // emitted. The callback method will therefore appear as an orphan in checkOrphans() even
  // though it IS consumed. Triagers should verify orphan findings on hook-registered symbols
  // before treating them as dead code — the absence of a `registers` edge does not mean the
  // callback is unreachable.
  // Similarly, calls into libs/vendor are not resolved as call-graph targets (a known
  // precision gap): if a function only calls external/vendor code it may still surface as an
  // orphan caller candidate even though it is legitimately called at runtime.
  for (const r of facts.registrations) {
    if (!r.callback) continue;
    const cbId = r.callback.includes('::') ? nodeId('method', r.callback) : nodeId('function', r.callback);
    addNode(g, { id: nodeId('hook', r.hook), kind: 'hook', name: r.hook, file: r.file, line: r.line, repo });
    if (g.nodes[cbId]) addEdge(g, { from: nodeId('hook', r.hook), to: cbId, kind: 'registers', file: r.file, line: r.line });
  }
  // 5. Fired hooks → hook node added for downstream consumers (e.g. registers edges).
  // Fix 2: <loader> phantom node for loads edges — create it once so edges reference a real node.
  // Fix 3: hooksFired entries carry no producer FQN so no meaningful `from` is available;
  //         the self-loop fires edge (from hookNode to hookNode) is dropped entirely.
  const loaderId = nodeId('function', '<loader>');
  addNode(g, { id: loaderId, kind: 'function', name: '<loader>', file: '', line: 0, repo, meta: { synthetic: true } });
  for (const h of facts.hooksFired) {
    addNode(g, { id: nodeId('hook', h.hook), kind: 'hook', name: h.hook, file: h.file, line: h.line, repo });
    // hooksFired sidecar carries no producer FQN, so no `fires` edge is emitted here.
  }
  // 6. Templates loaded → template nodes + loads edges with argKeys.
  for (const t of facts.templatesLoaded) {
    const tid = nodeId('template', t.template);
    addNode(g, { id: tid, kind: 'template', name: t.template, file: t.file, line: t.line, repo, meta: {} });
    addEdge(g, { from: loaderId, to: tid, kind: 'loads', file: t.file, line: t.line, meta: { argKeys: t.argKeys } });
  }
}

function nodeIdForFqn(g: FlowGraph, fqn: string): string {
  const m = nodeId('method', fqn);
  if (g.nodes[m]) return m;
  return nodeId('function', fqn);
}
