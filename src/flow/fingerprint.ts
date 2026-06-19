import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relativePath } from '../shared-utils.js';

export function fingerprintFiles(files: string[], repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const rel = relativePath(f, repoRoot);
    let content = '';
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    out[rel] = createHash('sha1').update(rel + '\0' + content).digest('hex');
  }
  return out;
}

export function diffFingerprints(
  prev: Record<string, string>,
  next: Record<string, string>,
): { changed: string[]; deleted: string[] } {
  const changed: string[] = [];
  for (const [rel, h] of Object.entries(next)) if (prev[rel] !== h) changed.push(rel);
  const deleted: string[] = [];
  for (const rel of Object.keys(prev)) if (!(rel in next)) deleted.push(rel);
  return { changed, deleted };
}
