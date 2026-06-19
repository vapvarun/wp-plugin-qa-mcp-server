import { inbound } from './flow/graph.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

const SELF_USED = new Set(['__construct', '__invoke', '__destruct', 'register', 'boot']);

export function checkOrphans(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const targets = Object.values(g.nodes).filter(n => n.kind === 'function' || n.kind === 'method' || n.kind === 'template');
  let orphans = 0;
  for (const n of targets) {
    const short = (n.meta?.short as string) ?? '';
    if (n.meta?.abstract) continue;
    if (n.kind === 'method' && SELF_USED.has(short)) continue;
    const consumed = inbound(g, n.id, ['calls', 'registers', 'loads', 'reads']).length > 0;
    if (consumed) continue;
    orphans++;
    issues.push({
      id: `orphan:${n.kind}:${n.name}`, category: 'orphan', severity: 'medium', type: 'warning',
      title: `${n.kind} ${n.name} is never consumed in the pair`,
      message: `No call / registration / template-load / read references ${n.name} anywhere in free+pro. Candidate dead code.`,
      file: n.file, line: n.line, code: 'orphan-symbol',
      fix: `Remove it, or wire the missing consumer if it was meant to be used.`,
    });
  }
  return { category: 'orphan', issues, passed: Math.max(0, targets.length - orphans), failed: orphans, skipped: 0, duration: Date.now() - start };
}
