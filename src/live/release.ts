/**
 * Release-artifact checks that need no site: the shipped .pot holds every
 * source string, the build fails loudly when it cannot regenerate the .pot,
 * and shipped code does not depend on files the release zip leaves out.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { ReleaseConfig } from './config.js';
import type { Row } from './checks.js';

const msgids = (pot: string) =>
  new Set([...readFileSync(pot, 'utf8').matchAll(/^msgid "(.+)"$/gm)].map((m) => m[1]));

export function checkPot(pluginPath: string, r: ReleaseConfig, slug: string, wpBin = 'wp'): Row {
  const guard = 'release:pot';
  const pot = join(pluginPath, r.pot ?? `languages/${slug}.pot`);
  if (!existsSync(pot)) return { guard, status: 'fail', detail: `${relative(pluginPath, pot)} is missing` };
  const dir = mkdtempSync(join(tmpdir(), 'wppqa-pot-'));
  try {
    const fresh = join(dir, 'fresh.pot');
    const exclude = ['node_modules', 'vendor', 'build', 'tests', 'dist', ...(r.excluded ?? []).map((e) => e.replace(/\/$/, ''))];
    execFileSync(wpBin, ['i18n', 'make-pot', pluginPath, fresh, `--domain=${r.domain ?? slug}`, `--exclude=${exclude.join(',')}`, '--skip-audit', '--quiet'], { stdio: 'pipe', timeout: 300000 });
    const have = msgids(pot);
    const missing = [...msgids(fresh)].filter((m) => !have.has(m));
    return missing.length
      ? { guard, status: 'fail', detail: `${relative(pluginPath, pot)} lacks ${missing.length} source strings, e.g. ${missing.slice(0, 3).map((m) => `"${m}"`).join(', ')}` }
      : { guard, status: 'pass', detail: 'pot holds every source string' };
  } catch (e) {
    return { guard, status: 'fail', detail: `could not run wp i18n make-pot: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A make-pot step followed by `|| …` or with errors sent to /dev/null ships a stale .pot silently. */
export function checkBuild(pluginPath: string, r: ReleaseConfig): Row {
  const guard = 'release:build';
  const scripts = (r.build_scripts ?? ['bin/build-release.sh']).filter((s) => existsSync(join(pluginPath, s)));
  if (!scripts.length) return { guard, status: 'skip', detail: `NOT RUN: no build script found (${(r.build_scripts ?? ['bin/build-release.sh']).join(', ')}), so make-pot handling is unchecked` };
  const bad: string[] = [];
  for (const s of scripts) {
    const lines = readFileSync(join(pluginPath, s), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/make-pot/.test(line) || /^\s*#|echo/.test(line)) return;
      // A continued command: read to the end of its backslash-joined lines.
      let cmd = line;
      for (let j = i; j < lines.length - 1 && /\\\s*$/.test(lines[j]); j++) cmd += ' ' + lines[j + 1];
      if (/2>\s*\/dev\/null|\|\|\s*(true|:|echo)/.test(cmd)) bad.push(`${s}:${i + 1}`);
    });
  }
  return bad.length
    ? { guard, status: 'fail', detail: `make-pot failure is swallowed at ${bad.join(', ')}` }
    : { guard, status: 'pass', detail: 'make-pot failure stops the build' };
}

interface Rule { re: RegExp; dirOnly: boolean; negated: boolean }

const globToRegex = (glob: string) =>
  glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');

/**
 * One .distignore line as a gitignore-style rule: a leading or inner "/"
 * anchors it to the plugin root, otherwise it matches that name at any depth;
 * a trailing "/" limits it to directories; "!" re-includes; "#" is a comment.
 */
export function distignoreRule(raw: string, forceAnchor = false): Rule | null {
  let p = raw.trim();
  if (!p || p.startsWith('#')) return null;
  const negated = p.startsWith('!');
  if (negated) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = forceAnchor || p.includes('/');
  p = p.replace(/^\//, '');
  if (!p) return null;
  return { re: new RegExp(`${anchored ? '^' : '(?:^|/)'}${globToRegex(p)}$`), dirOnly, negated };
}

/** Never scanned and never treated as "excluded from the zip" unless .distignore says so. */
const NEVER_SCANNED = ['node_modules', 'vendor', '.git'];

export interface Excluded {
  /** Every directory the zip leaves out, as "path/" relative to the plugin root. */
  dirs: string[];
  /** Shipped .php / .js files. */
  files: string[];
}

/** Walk the plugin applying .distignore (last matching rule wins) plus the configured `release.excluded` prefixes. */
export function excludedPaths(pluginPath: string, r: ReleaseConfig): Excluded {
  const rules: Rule[] = [];
  for (const x of r.excluded ?? []) {
    const rule = distignoreRule(x, true);
    if (rule) rules.push(rule);
  }
  const dist = join(pluginPath, '.distignore');
  if (existsSync(dist)) {
    for (const line of readFileSync(dist, 'utf8').split('\n')) {
      const rule = distignoreRule(line);
      if (rule) rules.push(rule);
    }
  }
  // A configured directory counts even when it is absent on disk (the check may run against an unpacked zip).
  const out: Excluded = { dirs: (r.excluded ?? []).filter((x) => x.endsWith('/')).map((x) => x.replace(/^\//, '')), files: [] };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = relative(pluginPath, p);
      const isDir = statSync(p).isDirectory();
      const hit = rules.filter((x) => (isDir || !x.dirOnly) && x.re.test(rel)).pop();
      if (hit && !hit.negated) {
        if (isDir && !out.dirs.includes(`${rel}/`)) out.dirs.push(`${rel}/`);
        continue;
      }
      if (isDir) {
        if (!NEVER_SCANNED.includes(name)) walk(p);
      } else if (/\.(php|js)$/.test(name) && !name.endsWith('.min.js')) out.files.push(p);
    }
  };
  walk(pluginPath);
  return out;
}

/**
 * Blank out comments, keeping line numbers and string contents. PHP is only
 * parsed inside <?php ... ?>, so apostrophes and "#" in template HTML are left
 * alone. Limits: heredoc bodies and JS regex literals are read as code, so a
 * "//" or quote inside one can blank the rest of that line.
 */
export function stripComments(src: string, php: boolean): string {
  let out = '';
  let inPhp = !php;
  let quote = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (!inPhp) {
      if (two === '<?') inPhp = true;
      out += c;
    } else if (quote) {
      out += c;
      if (c === '\\') out += src[++i] ?? '';
      else if (c === quote || (!php && c === '\n' && quote !== '`')) quote = '';
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (two === '//' || (php && c === '#' && src[i + 1] !== '[')) {
      let stop = src.indexOf('\n', i);
      if (stop === -1) stop = src.length;
      // In PHP a close tag ends a one-line comment.
      const close = php ? src.indexOf('?>', i) : -1;
      if (close !== -1 && close < stop) stop = close;
      out += ' '.repeat(stop - i);
      i = stop - 1;
    } else {
      if (php && two === '?>') inPhp = false;
      out += c;
    }
  }
  return out;
}

/** Shipped code that names an excluded path must check the file exists, or it breaks only on real installs. */
export function checkRefs(pluginPath: string, r: ReleaseConfig): Row {
  const guard = 'release:refs';
  const ex = excludedPaths(pluginPath, r);
  const dirs = ex.dirs;
  if (!dirs.length) return { guard, status: 'skip', detail: 'NOT RUN: no excluded directories (.distignore or release.excluded), so nothing was checked' };
  const bad: string[] = [];
  const files = ex.files.map((f) => ({ f, lines: stripComments(readFileSync(f, 'utf8'), f.endsWith('.php')).split('\n') }));
  const guarded = /file_exists|is_readable|is_file|is_dir/;
  // Request keys whose handler only works when an excluded file is present (e.g. ?seed_demo=1 -> tools/seed.php).
  const devOnlyKeys = new Map<string, string>();
  for (const { f, lines } of files) {
    lines.forEach((line, i) => {
      for (const d of dirs) {
        // 'tools/x.php' and __DIR__ . '/tools/x.php' are the same dependency.
        if (!new RegExp(`['"\`]/?${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(line)) continue;
        if ((r.allow_refs ?? []).some((a) => line.includes(a))) continue;
        const near = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
        if (!guarded.test(near)) {
          bad.push(`${relative(pluginPath, f)}:${i + 1} (${d})`);
          continue;
        }
        const handler = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
        for (const m of handler.matchAll(/\$_(?:GET|REQUEST|POST)\[\s*['"]([a-z0-9_-]+)['"]/gi)) devOnlyKeys.set(m[1], `${relative(pluginPath, f)}:${i + 1}`);
      }
    });
  }
  // A link or button to such a key must carry the same guard, or a real install shows a control that does nothing.
  for (const [key, handler] of devOnlyKeys) {
    for (const { f, lines } of files) {
      lines.forEach((line, i) => {
        if (/\$_(GET|REQUEST|POST)\[/.test(line)) return;
        if (!new RegExp(`[?&'"]${key}(=|['"])`).test(line)) return;
        if (guarded.test(lines.slice(Math.max(0, i - 6), i + 3).join('\n'))) return;
        bad.push(`${relative(pluginPath, f)}:${i + 1} offers "${key}", which works only with an excluded file (${handler})`);
      });
    }
  }
  return bad.length
    ? { guard, status: 'fail', detail: `shipped code depends on files the zip excludes, unguarded: ${bad.slice(0, 8).join(', ')}` }
    : { guard, status: 'pass', detail: 'no unguarded references to excluded files' };
}
