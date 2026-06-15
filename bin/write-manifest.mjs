#!/usr/bin/env node
/**
 * Deterministically generate a plugin's manifest v3 and write it to
 * <pluginPath>/audit/manifest.json. This is the onboard step — the scanner is the
 * single deterministic generator for every plugin (no agent prose).
 *
 *   node bin/write-manifest.mjs /abs/path/to/plugin
 *
 * Volatile fields (timestamp, absolute path) are stripped so the committed manifest
 * is churn-free and machine-independent.
 */

import { scanPlugin } from '../build/scanner.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const pluginPath = process.argv[2];
if (!pluginPath) {
  process.stderr.write('usage: node bin/write-manifest.mjs <pluginPath>\n');
  process.exit(1);
}

const m = scanPlugin(pluginPath);
delete m.scannedAt;                                  // timestamp → churn
m.pluginPath = m.header?.slug || 'plugin';           // absolute path → machine-specific
m.generated = { generator: 'wp-plugin-qa scanner', schema: 'v3-functional' };

const outDir = join(pluginPath, 'audit');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'manifest.json');
const json = JSON.stringify(m, null, 2) + '\n';
writeFileSync(outFile, json);
process.stdout.write(`wrote ${(json.length / 1024).toFixed(0)}KB → ${outFile}\n`);
