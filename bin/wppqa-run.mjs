#!/usr/bin/env node
// CLI for the same engine wppqa_run_checks uses, so a plugin's local CI and the
// release gate run exactly what the MCP runs. Exit 1 on any failure.
//
//   node bin/wppqa-run.mjs --plugin <dir> [--wp <wp-cli or site wrapper>] [--wp-root <dir>]
//        [--mode fast|full] [--only release,states:refund-free] [--fresh-site <url>]
//        [--artifacts <dir>] [--json <file>]
import { writeFileSync } from 'node:fs';
import { formatLedger, runChecks } from '../build/live/run.js';

const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const plugin = arg('plugin');
if (!plugin) {
  console.error('usage: wppqa-run.mjs --plugin <dir> [--wp <bin>] [--mode fast|full]');
  process.exit(2);
}
const ledger = await runChecks({
  pluginPath: plugin,
  wp: { bin: arg('wp') ?? 'wp', root: arg('wp-root') },
  mode: arg('mode') === 'full' ? 'full' : 'fast',
  only: arg('only')?.split(',').filter(Boolean),
  freshSiteUrl: arg('fresh-site'),
  artifactsDir: arg('artifacts'),
});
console.log(formatLedger(ledger));
const out = arg('json');
if (out) writeFileSync(out, JSON.stringify({ ...ledger, ran_at: new Date().toISOString() }, null, 2));
process.exit(ledger.ok ? 0 : 1);
