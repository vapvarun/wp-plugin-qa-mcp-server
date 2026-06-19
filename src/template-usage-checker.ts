import { join } from 'node:path';
import { inbound } from './flow/graph.js';
import { findPhpFiles, relativePath, dirExists } from './shared-utils.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

// Entrypoint = a top-level page template or a route-folder home, loaded by the router/WP directly.
const PARTS_DIRS = ['/parts/', '/partials/', '/blocks/'];
export function isEntrypoint(rel: string): boolean {
  if (PARTS_DIRS.some(d => rel.includes(d))) return false;
  const inTemplates = rel.replace(/^.*templates\//, '');
  return inTemplates.split('/').length <= 2; // templates/foo.php or templates/route/home.php
}

export function checkTemplateUsage(g: FlowGraph, repoRoots: string[]): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  // Set of loaded template names (graph node name == relative template path passed to loader).
  const loaded = new Set(Object.values(g.nodes).filter(n => n.kind === 'template' && inbound(g, n.id, ['loads']).length > 0).map(n => n.name));
  let checked = 0, orphaned = 0;
  for (const root of repoRoots) {
    const tplDir = join(root, 'templates');
    if (!dirExists(tplDir)) continue;
    for (const f of findPhpFiles(tplDir)) {
      const rel = relativePath(f, root);
      const nameForLoader = rel.replace(/^templates\//, '');
      checked++;
      if (isEntrypoint(rel)) continue;
      const isLoaded = [...loaded].some(l => l === nameForLoader || l.endsWith('/' + nameForLoader) || nameForLoader.endsWith('/' + l));
      if (!isLoaded) {
        orphaned++;
        issues.push({ id:`tpl-usage:never-loaded:${rel}`, category:'template-usage', severity:'medium', type:'warning',
          title:`Template ${rel} is never loaded`, message:`No buddynext_get_template() call references this part. Candidate dead template.`,
          file:rel, line:1, code:'template-never-loaded', fix:`Load it from the right place, or delete it.` });
      }
    }
  }
  return { category:'template-usage', issues, passed: Math.max(0, checked - orphaned), failed: 0 /* warnings only */, skipped: 0, duration: Date.now() - start };
}
