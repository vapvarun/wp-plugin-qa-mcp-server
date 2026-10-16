/**
 * Release-artifact checks that need no site: the shipped .pot holds every
 * source string, the build fails loudly when it cannot regenerate the .pot,
 * and shipped code does not depend on files the release zip leaves out.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
const msgids = (pot) => new Set([...readFileSync(pot, 'utf8').matchAll(/^msgid "(.+)"$/gm)].map((m) => m[1]));
export function checkPot(pluginPath, r, slug, wpBin = 'wp') {
    const guard = 'release:pot';
    const pot = join(pluginPath, r.pot ?? `languages/${slug}.pot`);
    if (!existsSync(pot))
        return { guard, status: 'fail', detail: `${relative(pluginPath, pot)} is missing` };
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
    }
    catch (e) {
        return { guard, status: 'fail', detail: `could not run wp i18n make-pot: ${e.message.split('\n')[0]}` };
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
/** A make-pot step followed by `|| …` or with errors sent to /dev/null ships a stale .pot silently. */
export function checkBuild(pluginPath, r) {
    const guard = 'release:build';
    const scripts = (r.build_scripts ?? ['bin/build-release.sh']).filter((s) => existsSync(join(pluginPath, s)));
    if (!scripts.length)
        return { guard, status: 'skip', detail: 'no build script found' };
    const bad = [];
    for (const s of scripts) {
        const lines = readFileSync(join(pluginPath, s), 'utf8').split('\n');
        lines.forEach((line, i) => {
            if (!/make-pot/.test(line) || /^\s*#|echo/.test(line))
                return;
            // A continued command: read to the end of its backslash-joined lines.
            let cmd = line;
            for (let j = i; j < lines.length - 1 && /\\\s*$/.test(lines[j]); j++)
                cmd += ' ' + lines[j + 1];
            if (/2>\s*\/dev\/null|\|\|\s*(true|:|echo)/.test(cmd))
                bad.push(`${s}:${i + 1}`);
        });
    }
    return bad.length
        ? { guard, status: 'fail', detail: `make-pot failure is swallowed at ${bad.join(', ')}` }
        : { guard, status: 'pass', detail: 'make-pot failure stops the build' };
}
/** Root-anchored entries of .distignore (what build scripts pass to rsync) plus configured prefixes. */
export function excludedPaths(pluginPath, r) {
    const prefixes = [...(r.excluded ?? [])];
    const names = ['node_modules', 'vendor', '.git'];
    const dist = join(pluginPath, '.distignore');
    if (existsSync(dist)) {
        for (const raw of readFileSync(dist, 'utf8').split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#'))
                continue;
            if (line.startsWith('/'))
                prefixes.push(line.slice(1));
            else
                names.push(line.replace(/\/$/, ''));
        }
    }
    return { prefixes: [...new Set(prefixes)], names };
}
function shipped(dir, root, ex, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const rel = relative(root, p);
        const isDir = statSync(p).isDirectory();
        if (ex.names.includes(name) || ex.prefixes.some((x) => (x.endsWith('/') ? `${rel}/`.startsWith(x) : rel === x)))
            continue;
        if (isDir)
            shipped(p, root, ex, out);
        else if (/\.(php|js)$/.test(name) && !name.endsWith('.min.js'))
            out.push(p);
    }
    return out;
}
const isComment = (line) => /^\s*(\/\/|\*|\/\*|#)/.test(line);
/** Shipped code that names an excluded path must check the file exists, or it breaks only on real installs. */
export function checkRefs(pluginPath, r) {
    const guard = 'release:refs';
    const ex = excludedPaths(pluginPath, r);
    const dirs = ex.prefixes.filter((x) => x.endsWith('/'));
    if (!dirs.length)
        return { guard, status: 'skip', detail: 'no excluded directories (.distignore or release.excluded)' };
    const bad = [];
    const files = shipped(pluginPath, pluginPath, ex).map((f) => ({ f, lines: readFileSync(f, 'utf8').split('\n') }));
    const guarded = /file_exists|is_readable|is_file|is_dir/;
    // Request keys whose handler only works when an excluded file is present (e.g. ?seed_demo=1 -> tools/seed.php).
    const devOnlyKeys = new Map();
    for (const { f, lines } of files) {
        lines.forEach((line, i) => {
            if (isComment(line))
                return;
            for (const d of dirs) {
                if (!new RegExp(`['"\`]${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(line))
                    continue;
                if ((r.allow_refs ?? []).some((a) => line.includes(a)))
                    continue;
                const near = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
                if (!guarded.test(near)) {
                    bad.push(`${relative(pluginPath, f)}:${i + 1} (${d})`);
                    continue;
                }
                const handler = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
                for (const m of handler.matchAll(/\$_(?:GET|REQUEST|POST)\[\s*['"]([a-z0-9_-]+)['"]/gi))
                    devOnlyKeys.set(m[1], `${relative(pluginPath, f)}:${i + 1}`);
            }
        });
    }
    // A link or button to such a key must carry the same guard, or a real install shows a control that does nothing.
    for (const [key, handler] of devOnlyKeys) {
        for (const { f, lines } of files) {
            lines.forEach((line, i) => {
                if (isComment(line) || /\$_(GET|REQUEST|POST)\[/.test(line))
                    return;
                if (!new RegExp(`[?&'"]${key}(=|['"])`).test(line))
                    return;
                if (guarded.test(lines.slice(Math.max(0, i - 6), i + 3).join('\n')))
                    return;
                bad.push(`${relative(pluginPath, f)}:${i + 1} offers "${key}", which works only with an excluded file (${handler})`);
            });
        }
    }
    return bad.length
        ? { guard, status: 'fail', detail: `shipped code depends on files the zip excludes, unguarded: ${bad.slice(0, 8).join(', ')}` }
        : { guard, status: 'pass', detail: 'no unguarded references to excluded files' };
}
//# sourceMappingURL=release.js.map