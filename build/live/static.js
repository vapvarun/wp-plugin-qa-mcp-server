/**
 * Replays a plugin's `checks.static` guards: one shell command each, run in the
 * plugin directory. A guard fails on a FAIL line, a PHP fatal, or a non-zero exit
 * that printed nothing recognisable, so a guard that dies silently is not green.
 */
import { spawnSync } from 'node:child_process';
const NOISE = /opcache|Xdebug|Zend|imagick|Derick|PHP Startup|Colors\.php/;
export function staticGuard(pluginPath, cli, g) {
    const env = { ...process.env, WP_CLI: cli.bin + (cli.root ? ` --path=${cli.root}` : '') };
    const r = spawnSync('bash', ['-c', g.run], { cwd: pluginPath, env, encoding: 'utf8', timeout: 300000 });
    const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter((l) => l.trim() && !NOISE.test(l));
    const bad = lines.filter((l) => /^FAIL|Fatal error|Uncaught/.test(l));
    const guard = `static:${g.id}`;
    if (bad.length)
        return { guard, status: 'fail', detail: bad.slice(0, 3).join(' | ') };
    if (r.status !== 0)
        return { guard, status: 'fail', detail: `exit ${r.status}: ${lines.slice(-1)[0] ?? 'no output'}` };
    return { guard, status: 'pass', detail: '' };
}
//# sourceMappingURL=static.js.map