#!/usr/bin/env node
import { runFlowAudit } from './flow-audit.js';

const [freeRoot, proRoot] = process.argv.slice(2);
if (!freeRoot) { console.error('usage: flow-audit-cli <freeRoot> [proRoot]'); process.exit(2); }
const generated = new Date().toISOString();
const { results, errorCount } = runFlowAudit({ freeRoot, proRoot, generated });
for (const r of results) console.log(`${r.category}: ${r.issues.filter(i=>i.type==='error').length} err / ${r.issues.length} findings`);
console.log(`\nTotal errors: ${errorCount}. Report: ${freeRoot}/audit/flow-audit-report.md`);
process.exit(errorCount > 0 ? 1 : 0);
