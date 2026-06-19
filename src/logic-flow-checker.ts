import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

export function checkLogicFlow(g: FlowGraph, journeys: Array<{id:string;name:string;entry:string}>): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const routePaths = Object.values(g.nodes).filter(n => n.kind === 'route').map(n => n.name.split(' ')[1]);
  const matched = new Set<string>();
  for (const j of journeys) {
    const hit = routePaths.find(p => p === j.entry || p.startsWith(j.entry + '/') || j.entry.startsWith(p + '/'));
    if (hit) { matched.add(hit); continue; }
    issues.push({ id:`logic-flow:no-path:${j.id}`, category:'logic-flow', severity:'medium', type:'warning',
      title:`Journey "${j.name}" has no implementing entry`, message:`journeys.json entry ${j.entry} resolves to no route in the graph. Coverage gap or stale journey.`,
      file:'audit/journeys.json', line:0, code:'logic-flow-no-path', fix:`Implement the entry, or update/remove the journey.` });
  }
  for (const p of routePaths) if (!matched.has(p))
    issues.push({ id:`logic-flow:undocumented:${p}`, category:'logic-flow', severity:'low', type:'info',
      title:`Route ${p} is in no documented journey`, message:`Consider adding a journey + cert oracle for go-live coverage.`,
      file:'', line:0, code:'logic-flow-undocumented', fix:`Add to journeys.json if user-facing.` });
  const failed = 0; // warnings/info only
  return { category:'logic-flow', issues, passed: matched.size, failed, skipped: 0, duration: Date.now() - start };
}
