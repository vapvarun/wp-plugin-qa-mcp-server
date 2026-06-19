import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { buildGraph } from './flow/build.js';
import { writeGraph } from './flow/graph.js';
import { checkDupFunctions } from './dup-function-checker.js';
import { checkOrphans } from './orphan-checker.js';
import { checkRestFlow } from './rest-flow-checker.js';
import { checkCanonicalUsage } from './canonical-usage-checker.js';
import { checkTemplateUsage } from './template-usage-checker.js';
import { checkLogicFlow } from './logic-flow-checker.js';
import { checkTemplateContracts } from './template-contract-checker.js';
import { checkRestJsContract } from './rest-js-contract-checker.js';
import { loadBaseline, applyBaseline } from './flow/baseline.js';
import { renderReport } from './flow/report.js';
import { fileExists } from './shared-utils.js';
import type { CheckerResult } from './types.js';

export function runFlowAudit(opts: { freeRoot: string; proRoot?: string; generated: string }):
  { results: CheckerResult[]; report: string; errorCount: number } {
  const g = buildGraph(opts);
  const repoRoots = [opts.freeRoot, ...(opts.proRoot ? [opts.proRoot] : [])];

  let journeys: unknown = [];
  const jp = join(opts.freeRoot, 'audit', 'journeys.json');
  if (fileExists(jp)) { try { journeys = JSON.parse(readFileSync(jp, 'utf8')); } catch { /* ignore */ } }

  const results: CheckerResult[] = [
    checkDupFunctions(g),
    checkOrphans(g),
    checkRestFlow(g),
    checkCanonicalUsage(repoRoots),
    checkTemplateUsage(g, repoRoots),
    checkLogicFlow(g, Array.isArray(journeys) ? journeys : (journeys as any).journeys ?? []),
    checkTemplateContracts(opts.freeRoot),
    checkRestJsContract(opts.freeRoot),
  ];

  const baseline = loadBaseline(join(opts.freeRoot, 'audit', '.flow-audit-baseline.json'));
  for (const r of results) r.issues = applyBaseline(r.issues, baseline);

  const report = renderReport(results, { generated: opts.generated, repos: repoRoots });
  writeGraph(join(opts.freeRoot, 'audit', 'flow.json'), g);
  writeFileSync(join(opts.freeRoot, 'audit', 'flow-audit-report.md'), report);
  const errorCount = results.reduce((a, r) => a + r.issues.filter(i => i.type === 'error').length, 0);
  return { results, report, errorCount };
}
