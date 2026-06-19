import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveScanScope } from './flow/scope.js';
import { CANONICAL_RULES, type CanonicalRule } from './flow/canonical-rules.js';
import { findPhpFiles, relativePath, getLineNumber, dirExists } from './shared-utils.js';
import type { CheckerResult, CheckerIssue } from './types.js';

export function scanForRule(content: string, rule: CanonicalRule): number[] {
  const lines: number[] = [];
  const re = new RegExp(rule.pattern.source, 'g');
  for (const m of content.matchAll(re)) lines.push(getLineNumber(content, m.index ?? 0));
  return lines;
}

export function checkCanonicalUsage(repoRoots: string[]): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  let scanned = 0;
  for (const root of repoRoots) {
    const { includeDirs } = resolveScanScope(root);
    const tplDir = join(root, 'templates');
    const tplFiles = dirExists(tplDir) ? findPhpFiles(tplDir) : [];
    const allPhp: string[] = [];
    for (const d of includeDirs) allPhp.push(...findPhpFiles(d));
    for (const f of allPhp) {
      const isTpl = tplFiles.includes(f);
      let content = ''; try { content = readFileSync(f, 'utf8'); } catch { continue; }
      scanned++;
      for (const rule of CANONICAL_RULES) {
        if (rule.appliesTo === 'template' && !isTpl) continue;
        if (rule.appliesTo === 'php' && isTpl) continue;
        for (const line of scanForRule(content, rule)) {
          const rel = relativePath(f, root);
          issues.push({ id:`wrong-fn:${rule.id}:${rel}:${line}`, category:'canonical-usage', severity:'high', type:'error',
            title:`Wrong-layer usage: ${rule.id}`, message:rule.message, file:rel, line, code:'canonical-usage-violation', fix:rule.fix });
        }
      }
    }
  }
  const failed = issues.length;
  return { category:'canonical-usage', issues, passed: Math.max(0, scanned - failed), failed, skipped: 0, duration: Date.now() - start };
}
