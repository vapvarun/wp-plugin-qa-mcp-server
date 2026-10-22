import { readFileSync } from 'node:fs';
import { fileExists } from '../shared-utils.js';
import type { CheckerIssue } from '../types.js';

export interface FlowBaseline { suppressions: { id: string; reason: string }[]; }

export function loadBaseline(path: string): FlowBaseline {
  if (!fileExists(path)) return { suppressions: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')) as FlowBaseline; } catch { return { suppressions: [] }; }
}
export function applyBaseline(issues: CheckerIssue[], baseline: { suppressions: { id: string; reason?: string }[] }): CheckerIssue[] {
  const sup = new Set(baseline.suppressions.map(s => s.id));
  return issues.filter(i => !sup.has(i.id));
}
