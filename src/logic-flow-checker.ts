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
  // Collect undocumented routes and emit a single summary instead of per-route noise.
  const undocumented = routePaths.filter(p => !matched.has(p));
  if (undocumented.length > 0) {
    const MAX_LISTED = 30;
    const listed = undocumented.slice(0, MAX_LISTED);
    const overflow = undocumented.length - listed.length;
    const routeList = listed.join(', ') + (overflow > 0 ? `, +${overflow} more` : '');
    issues.push({ id:`logic-flow:undocumented-summary`, category:'logic-flow', severity:'low', type:'info',
      title:`${undocumented.length} route(s) have no documented journey`,
      message:`${undocumented.length} route(s) not covered by journeys.json: ${routeList}. Consider adding journeys + cert oracles for go-live coverage.`,
      file:'', line:0, code:'logic-flow-undocumented', fix:`Add to journeys.json for any user-facing route.` });
  }
  const failed = 0; // warnings/info only
  return { category:'logic-flow', issues, passed: matched.size, failed, skipped: 0, duration: Date.now() - start };
}
