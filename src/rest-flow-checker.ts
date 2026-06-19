import { inbound } from './flow/graph.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

export function checkRestFlow(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const routes = Object.values(g.nodes).filter(n => n.kind === 'route');
  let checked = 0;
  for (const r of routes) {
    const shapeKeys = (r.meta?.shapeKeys as string[]) ?? [];
    if (r.meta?.shapeUnresolved) {
      issues.push({ id:`rest-flow:shape-unresolved:${r.name}`, category:'rest-flow', severity:'low', type:'info',
        title:`Response shape unresolved for ${r.name}`, message:`Handler returns a dynamic/hydrated shape; key-level flow not checked.`,
        file:r.file, line:0, code:'rest-flow-unresolved', fix:`(no action) or return a literal array to enable key checks.` });
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
    for (const key of shapeKeys) if (!readSet.has(key))
      issues.push({ id:`rest-flow:dead-output:${r.name}:${key}`, category:'rest-flow', severity:'low', type:'warning',
        title:`${r.name} returns "${key}" but no consumer reads it`,
        message:`Dead output key; either a consumer is missing or the field can be dropped.`,
        file:r.file, line:0, code:'rest-flow-dead-output', fix:`Wire a consumer or remove the field.` });
  }
  const failed = issues.filter(i => i.type === 'error').length;
  return { category:'rest-flow', issues, passed: Math.max(0, checked - failed), failed, skipped: 0, duration: Date.now() - start };
}
