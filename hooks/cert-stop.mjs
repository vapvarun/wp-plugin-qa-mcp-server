#!/usr/bin/env node
/**
 * Claude Code Stop hook — the real-time self-correction gate.
 *
 * After the agent finishes a turn, this runs the generic functional engine on the
 * plugin it touched and BLOCKS the agent from finishing if it introduced a confirmed
 * behavioural failure (dead toggle, route fatal). Cheap no-op when nothing changed.
 *
 * Register in ~/.claude/settings.json (see hooks/README.md):
 *   "hooks": { "Stop": [ { "hooks": [ { "type": "command",
 *     "command": "node ~/.mcp-servers/wp-plugin-qa-mcp-server/hooks/cert-stop.mjs" } ] } ] }
 *
 * Per-repo config: <projectDir>/.cert.json = { "wp_path": "...", "plugin_path": "...", "oracles_path": "..." }
 * (plugin_path defaults to the repo; oracles_path defaults to <plugin>/audit/cert-oracles.json).
 * Without a wp_path (config or BN_WP_PATH env), the hook is a no-op.
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runEngine } from '../build/cert-runner.js';

function done(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// 1. Read the hook payload (Claude Code provides cwd + session_id on stdin).
let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf-8') || '{}'); } catch { /* no stdin */ }
const projectDir = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

// 2. Resolve config.
let cfg = {};
const cfgPath = join(projectDir, '.cert.json');
if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')); } catch { /* bad json */ } }
const wpRoot = cfg.wp_path || process.env.BN_WP_PATH;
const pluginPath = cfg.plugin_path || projectDir;
if (!wpRoot) done(); // not a cert-configured repo → no-op.
const oraclesPath = cfg.oracles_path
  || (existsSync(join(pluginPath, 'audit/cert-oracles.json')) ? join(pluginPath, 'audit/cert-oracles.json') : undefined);

// 3. Cheap exit if no PHP/JS changed this session.
let changed = '';
try { changed = execFileSync('git', ['-C', pluginPath, 'diff', '--name-only', 'HEAD'], { encoding: 'utf-8' }); } catch { done(); }
if (!/\.(php|js)$/m.test(changed)) done();

// 4. Run the engine.
const result = runEngine({ wpRoot, pluginPath, oraclesPath });
if (!result.ran || !result.ledger) done(); // engine couldn't run → don't block (fail safe).
const fails = result.ledger.rows.filter((r) => r.status === 'fail');

// 5. Baseline diff — only block on failures NOT present at session start.
const session = payload.session_id || 'default';
const baseFile = join(tmpdir(), `cert-baseline-${session}.json`);
if (!existsSync(baseFile)) {
  // First Stop this session: capture the baseline, don't block (pre-existing debt isn't ours).
  writeFileSync(baseFile, JSON.stringify(fails.map((f) => f.entity)));
  done();
}
let baseline = [];
try { baseline = JSON.parse(readFileSync(baseFile, 'utf-8')); } catch { /* ignore */ }
const newFails = fails.filter((f) => !baseline.includes(f.entity));
if (newFails.length === 0) done();

// 6. Block — feed the corrections back to the agent.
const reason = 'Functional certification FAILED — you introduced behaviour that does not work:\n'
  + newFails.map((f) => `  ✗ ${f.check}/${f.entity} — ${f.detail}`).join('\n')
  + '\nFix these, then finishing will be allowed (the Stop hook re-checks).';
done({ decision: 'block', reason });
