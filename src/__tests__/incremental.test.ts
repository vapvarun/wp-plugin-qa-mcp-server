// src/__tests__/incremental.test.ts
// Verifies that buildOrUpdate is correctly wired: identical graph on no change,
// and a rebuilt graph when a file is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildGraph, buildOrUpdate } from '../flow/build.js';
import { writeGraph } from '../flow/graph.js';

// Guard: skip if php is not available
function phpAvailable(): boolean {
  try {
    execFileSync('php', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

test('incremental-equivalence: no change reuses cached graph, touched file triggers rebuild', async () => {
  if (!phpAvailable()) {
    console.log('SKIP: php not available on this machine');
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'bn-inc-test-'));
  try {
    // Set up minimal fixture: includes/helpers.php with one function
    const includesDir = join(tmp, 'includes');
    mkdirSync(includesDir, { recursive: true });
    writeFileSync(join(includesDir, 'helpers.php'), `<?php
function test_fixture_helper() {
    return 'hello';
}
`);

    // Step 1: full build
    const g1 = buildGraph({ freeRoot: tmp, generated: 't' });

    // Persist the graph so buildOrUpdate can read it
    const auditDir = join(tmp, 'audit');
    mkdirSync(auditDir, { recursive: true });
    writeGraph(join(auditDir, 'flow.json'), g1);

    const g1NodeIds = new Set(Object.keys(g1.nodes));
    const g1Fingerprints = { ...g1.fingerprints };

    // Step 2: incremental build with NO file changes → should reuse the cached graph
    const g2 = buildOrUpdate({ freeRoot: tmp, generated: 't' });
    const g2NodeIds = new Set(Object.keys(g2.nodes));

    // Same node ids
    assert.deepEqual(
      [...g2NodeIds].sort(),
      [...g1NodeIds].sort(),
      'no-change buildOrUpdate must return same node ids as full build',
    );
    // Same fingerprints (confirming the object was reused, not rebuilt)
    assert.deepEqual(
      g2.fingerprints,
      g1Fingerprints,
      'no-change buildOrUpdate must return identical fingerprints',
    );

    // Step 3: touch a file (add a new function)
    appendFileSync(join(includesDir, 'helpers.php'), `\nfunction test_fixture_added() {}\n`);

    // Incremental build after touch → must rebuild and expose the new function
    const g3 = buildOrUpdate({ freeRoot: tmp, generated: 't' });

    const newFnId = 'function:test_fixture_added';
    assert.ok(
      newFnId in g3.nodes,
      `after touching helpers.php, buildOrUpdate must include "${newFnId}"`,
    );

    // Fingerprints must have changed for the touched file
    const changedKey = Object.keys(g3.fingerprints).find(k => k.includes('helpers.php'));
    const prevKey    = Object.keys(g1Fingerprints).find(k => k.includes('helpers.php'));
    assert.ok(changedKey, 'helpers.php must appear in g3 fingerprints');
    assert.ok(prevKey, 'helpers.php must have appeared in g1 fingerprints');
    assert.notEqual(
      g3.fingerprints[changedKey!],
      g1Fingerprints[prevKey!],
      'fingerprint for helpers.php must differ after appending a function',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
