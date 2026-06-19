import { inbound } from './flow/graph.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

// Framework-convention entrypoints (e.g. register/boot): assumed consumed by the host even without a graph edge. Trade-off: a coincidentally-named dead method is not flagged.
const SELF_USED = new Set(['__construct', '__invoke', '__destruct', 'register', 'boot']);

export function checkOrphans(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const targets = Object.values(g.nodes).filter(n => n.kind === 'function' || n.kind === 'method' || n.kind === 'template');
  // Build a set of referenced short names from the sidecar-emitted floor (suppresses false alarms
  // from [$this,'method'] callbacks, dynamic $obj->method(), REST/AJAX handlers, etc.)
  const refNames = new Set(g.referencedNames ?? []);
  let orphans = 0;
  for (const n of targets) {
    const short = (n.meta?.short as string) ?? '';
    // Skip synthetic graph nodes (<global>, <loader>)
    if (n.name.startsWith('<') || short.startsWith('<')) continue;
    if (n.meta?.abstract) continue;
    if (n.kind === 'method' && SELF_USED.has(short)) continue;
    const consumed = inbound(g, n.id, ['calls', 'registers', 'loads', 'reads']).length > 0;
    if (consumed) continue;
    // Name-reference floor: if the short name appears anywhere as a call target or callback string,
    // suppress the finding to avoid false "dead code" alarms.
    if (short && refNames.has(short)) continue;
    orphans++;
    issues.push({
      id: `orphan:${n.kind}:${n.name}`, category: 'orphan', severity: 'medium', type: 'warning',
      title: `Dead code: ${n.name} is never referenced`,
      message: `${n.kind} ${n.name} is defined but appears nowhere in the free+pro code as a call, callback, hook/REST/AJAX registration, or template load. Confirmed unreferenced by name.`,
      file: n.file, line: n.line, code: 'orphan-symbol',
      fix: `Remove it. If it was meant to be active (e.g. left behind by a reverted/disabled integration), wire its missing registration instead.`,
    });
  }
  return { category: 'orphan', issues, passed: Math.max(0, targets.length - orphans), failed: orphans, skipped: 0, duration: Date.now() - start };
}
