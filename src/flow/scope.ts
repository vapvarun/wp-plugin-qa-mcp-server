import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirExists, fileExists } from '../shared-utils.js';

const THIRD_PARTY = new Set(['libs', 'vendor']);
const DEFAULT_RUNTIME = ['includes', 'templates', 'assets', 'blocks'];

function parseArray(sh: string, name: string): string[] {
  const m = sh.match(new RegExp(name + '=\\(([^)]*)\\)'));
  if (!m) return [];
  return m[1].split(/\s+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

export function resolveScanScope(repoRoot: string): { includeDirs: string[]; thirdParty: string[] } {
  const buildSh = join(repoRoot, 'bin', 'build-release.sh');
  let entries: string[];
  if (fileExists(buildSh)) {
    const sh = readFileSync(buildSh, 'utf8');
    entries = [...parseArray(sh, 'RUNTIME'), ...parseArray(sh, 'OPTIONAL')];
  } else {
    entries = [...DEFAULT_RUNTIME];
  }
  const include: string[] = [];
  const third: string[] = [];
  for (const e of entries) {
    const abs = join(repoRoot, e);
    if (!dirExists(abs) && !fileExists(abs)) continue;
    if (THIRD_PARTY.has(e)) third.push(abs); else include.push(abs);
  }
  // Always treat vendor/libs as third-party even if not in allowlist.
  for (const e of THIRD_PARTY) {
    const abs = join(repoRoot, e);
    if (dirExists(abs) && !third.includes(abs)) third.push(abs);
  }
  return { includeDirs: include, thirdParty: third };
}
