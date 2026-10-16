/**
 * Runs PHP against the live site through WP-CLI. Snippets come from the
 * plugin's qa-config and must `return` a value; it comes back as JSON.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const MARK = '__WPPQA_JSON__';
export function wpEval(cli, php, vars = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'wppqa-'));
    const file = join(dir, 'snippet.php');
    // Vars arrive as $vars so snippets can use ids returned by an earlier setup step.
    writeFileSync(file, 
    // Base64 keeps `$` and quotes in the payload away from PHP string interpolation.
    `<?php\n$vars = json_decode(base64_decode('${Buffer.from(JSON.stringify(vars)).toString('base64')}'), true);\n` +
        `$__r = (function () use ($vars) {\n${php}\n})();\necho "${MARK}" . wp_json_encode($__r);\n`);
    const args = [...(cli.root ? [`--path=${cli.root}`] : []), 'eval-file', file];
    try {
        const out = execFileSync(cli.bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
        const i = out.lastIndexOf(MARK);
        if (i < 0)
            throw new Error(`no result from snippet; output: ${out.slice(0, 500)}`);
        return JSON.parse(out.slice(i + MARK.length));
    }
    catch (e) {
        const err = e;
        throw new Error(`wp eval failed: ${(err.stderr || err.stdout || err.message || '').slice(0, 800)}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
//# sourceMappingURL=wp.js.map