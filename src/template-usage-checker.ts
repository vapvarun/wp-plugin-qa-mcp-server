import { join, basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { inbound } from './flow/graph.js';
import { findPhpFiles, findJsFiles, relativePath, dirExists } from './shared-utils.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

// Entrypoint = a top-level page template or a route-folder home, loaded by the router/WP directly.
const PARTS_DIRS = ['/parts/', '/partials/', '/blocks/'];
export function isEntrypoint(rel: string): boolean {
  if (PARTS_DIRS.some(d => rel.includes(d))) return false;
  const inTemplates = rel.replace(/^.*templates\//, '');
  return inTemplates.split('/').length <= 2; // templates/foo.php or templates/route/home.php
}

// Build a set of all quoted string literal substrings across all PHP+JS source files in the repo roots.
// Used as a reference floor: if a template's basename or loader-relative path appears in any string
// literal it may be loaded dynamically — don't flag it.
function buildStringLiterals(repoRoots: string[]): Set<string> {
  const literals = new Set<string>();
  const quoteRe = /['"]([^'"]{3,})['"]/g;
  for (const root of repoRoots) {
    const phpFiles = (() => { try { return findPhpFiles(root); } catch { return []; } })();
    const jsFiles  = (() => { try { return findJsFiles(join(root, 'assets')); } catch { return []; } })();
    for (const f of [...phpFiles, ...jsFiles]) {
      let src = ''; try { src = readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of src.matchAll(quoteRe)) literals.add(m[1]);
    }
  }
  return literals;
}

export function checkTemplateUsage(g: FlowGraph, repoRoots: string[]): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  // Set of loaded template names (graph node name == relative template path passed to loader).
  const loaded = new Set(Object.values(g.nodes).filter(n => n.kind === 'template' && inbound(g, n.id, ['loads']).length > 0).map(n => n.name));

  // Build reference floor once: any quoted string containing the template name counts as a reference.
  const stringLiterals = buildStringLiterals(repoRoots);

  let checked = 0, orphaned = 0;
  for (const root of repoRoots) {
    const tplDir = join(root, 'templates');
    if (!dirExists(tplDir)) continue;
    for (const f of findPhpFiles(tplDir)) {
      const rel = relativePath(f, root);
      const nameForLoader = rel.replace(/^templates\//, '');
      const base = basename(f);
      checked++;
      if (isEntrypoint(rel)) continue;
      const isLoaded = [...loaded].some(l => l === nameForLoader || l.endsWith('/' + nameForLoader) || nameForLoader.endsWith('/' + l));
      if (!isLoaded) {
        // Reference floor: if any quoted string literal contains the loader-relative path or
        // the basename, a dynamic/computed load may exist — suppress the finding.
        const isReferenced = [...stringLiterals].some(s => s.includes(nameForLoader) || s.includes(base));
        if (isReferenced) continue;
        orphaned++;
        issues.push({ id:`tpl-usage:never-loaded:${rel}`, category:'template-usage', severity:'medium', type:'warning',
          title:`Template ${rel} is never loaded`,
          message:`Template ${rel} is never loaded and its name is referenced nowhere — remove it, or wire the missing \`buddynext_get_template()\` call.`,
          file:rel, line:1, code:'template-never-loaded',
          fix:`Load it from the right place, or delete it.` });
      }
    }
  }
  return { category:'template-usage', issues, passed: Math.max(0, checked - orphaned), failed: 0 /* warnings only */, skipped: 0, duration: Date.now() - start };
}
