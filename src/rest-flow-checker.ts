import { inbound } from './flow/graph.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

export function checkRestFlow(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const routes = Object.values(g.nodes).filter(n => n.kind === 'route');
  let checked = 0;
  const unresolvedRoutes: string[] = [];
  for (const r of routes) {
    const shapeKeys = (r.meta?.shapeKeys as string[]) ?? [];
    if (r.meta?.shapeUnresolved) {
      unresolvedRoutes.push(r.name);
      continue;
    }
    checked++;
    const reads = inbound(g, r.id, ['reads']).map(e => e.meta?.prop as string).filter(Boolean);
    const readSet = new Set(reads);
    for (const prop of readSet) if (!shapeKeys.includes(prop))
      issues.push({ id:`rest-flow:broken-read:${r.name}:${prop}`, category:'rest-flow', severity:'high', type:'error',
        title:`Consumer reads "${prop}" but ${r.name} never returns it`,
        message:`JS reads data.${prop}; route shape is {${shapeKeys.join(', ')}}. Envelope mismatch → blank UI.`,
        file:r.file, line:0, code:'rest-flow-broken-read', fix:`Add "${prop}" to the response or fix the JS key.` });
  }
  if (unresolvedRoutes.length > 0) {
    const first30 = unresolvedRoutes.slice(0, 30);
    const rest = unresolvedRoutes.length - first30.length;
    const routeList = rest > 0
      ? `${first30.join(', ')} +${rest} more`
      : first30.join(', ');
    issues.push({
      id: 'rest-flow:shape-unresolved-summary', category: 'rest-flow', severity: 'low', type: 'info',
      title: `${unresolvedRoutes.length} routes have unresolved response shapes (key-level flow not checked)`,
      message: `These routes return a dynamic/hydrated shape; key-level flow cannot be checked statically. Routes (first 30): ${routeList}.`,
      file: '', line: 0, code: 'rest-flow-unresolved-summary',
      fix: `(no action) or return a literal array to enable key checks.`,
    });
  }
  const failed = issues.filter(i => i.type === 'error').length;
  return { category: 'rest-flow', issues, passed: Math.max(0, checked - failed), failed, skipped: 0, duration: Date.now() - start };
}
