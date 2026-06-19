// src/__tests__/template-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isEntrypoint, checkTemplateUsage } from '../template-usage-checker.js';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';

test('parts are not entrypoints; top-level page templates are', () => {
  assert.equal(isEntrypoint('templates/parts/post-card.php'), false);
  assert.equal(isEntrypoint('templates/feed/home.php'), true);
  assert.equal(isEntrypoint('templates/members.php'), true);
});

test('checkTemplateUsage: orphan flagged, loaded part not flagged, bare-suffix distractor does not suppress orphan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-usage-test-'));
  try {
    // Create template part files on disk
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'post-card.php'), '<?php // post-card ?>');
    writeFileSync(join(dir, 'templates', 'parts', 'orphan-widget.php'), '<?php // orphan ?>');

    // Build a graph
    const g = emptyGraph({ free: dir }, new Date().toISOString());

    // post-card node with an inbound `loads` edge (so it IS loaded)
    const postCardId = nodeId('template', 'parts/post-card.php');
    addNode(g, { id: postCardId, kind: 'template', name: 'parts/post-card.php', file: 'templates/parts/post-card.php', line: 1, repo: 'free' });
    const loaderId = nodeId('route', 'feed-home');
    addNode(g, { id: loaderId, kind: 'route', name: 'feed-home', file: 'src/feed.php', line: 1, repo: 'free' });
    addEdge(g, { from: loaderId, to: postCardId, kind: 'loads', file: 'src/feed.php', line: 10 });

    // DISTRACTOR: bare 'card.php' node with a loads edge — the old code's buggy arm
    // `nameForLoader.endsWith(l)` would match 'parts/post-card.php'.endsWith('card.php') = TRUE,
    // which also risks matching 'parts/orphan-widget.php' if any loaded bare suffix is e.g. 'widget.php'
    // We add a distractor whose bare name is 'card.php' — under old code, this suppresses post-card
    // (post-card would pass even without the direct loads edge), but must NOT suppress orphan-widget.
    const distractorId = nodeId('template', 'card.php');
    addNode(g, { id: distractorId, kind: 'template', name: 'card.php', file: 'templates/card.php', line: 1, repo: 'free' });
    const distractorLoaderId = nodeId('route', 'distractor-loader');
    addNode(g, { id: distractorLoaderId, kind: 'route', name: 'distractor-loader', file: 'src/distractor.php', line: 1, repo: 'free' });
    addEdge(g, { from: distractorLoaderId, to: distractorId, kind: 'loads', file: 'src/distractor.php', line: 5 });

    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    // orphan-widget must be flagged
    assert.ok(
      issueIds.some(id => id.includes('orphan-widget.php')),
      `Expected orphan-widget.php to be flagged, got: ${JSON.stringify(issueIds)}`
    );

    // post-card must NOT be flagged (has a direct inbound loads edge)
    assert.ok(
      !issueIds.some(id => id.includes('post-card.php')),
      `Expected post-card.php NOT to be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
