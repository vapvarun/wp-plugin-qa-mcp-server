// src/__tests__/template-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isEntrypoint, checkTemplateUsage } from '../template-usage-checker.js';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';

// Helpers to create a minimal test repo tree
function makeRepo(dir: string, phpContent: string = '') {
  mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
  // assets/js for JS source (optional)
  if (phpContent) writeFileSync(join(dir, 'loader.php'), phpContent);
}

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

    // DISTRACTOR: a bare-named loaded template 'widget.php' that is a SUFFIX of the
    // orphan disk file 'parts/orphan-widget.php'. This is the trap that RED→GREENs the fix:
    //   OLD arm  `nameForLoader.endsWith(l)`        → 'parts/orphan-widget.php'.endsWith('widget.php') = TRUE
    //            → orphan-widget WRONGLY suppressed → "orphan flagged" assertion FAILS (RED).
    //   FIXED arm `nameForLoader.endsWith('/' + l)` → endsWith('/widget.php') = FALSE
    //            → orphan-widget correctly flagged (GREEN).
    const distractorId = nodeId('template', 'widget.php');
    addNode(g, { id: distractorId, kind: 'template', name: 'widget.php', file: 'templates/widget.php', line: 1, repo: 'free' });
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

    // Message format check: orphan issue uses pinpoint message
    const orphanIssue = result.issues.find(i => i.id.includes('orphan-widget.php'));
    assert.ok(orphanIssue?.message.includes('loaded by nothing'), 'message should say "loaded by nothing"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkTemplateUsage: template whose basename appears in a PHP string literal is NOT flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-reffloor-test-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'dynamic-card.php'), '<?php // dynamic ?>');
    // A PHP source file that references the template basename via a string literal (dynamic load)
    writeFileSync(join(dir, 'loader.php'), `<?php buddynext_get_template( $prefix . 'dynamic-card.php' ); ?>`);

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      !issueIds.some(id => id.includes('dynamic-card.php')),
      `dynamic-card.php (basename in string literal) must NOT be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkTemplateUsage: template whose name appears nowhere in source IS flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-reffloor-nowhere-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'truly-orphan.php'), '<?php // orphan ?>');
    // No PHP/JS source references 'truly-orphan.php' anywhere
    writeFileSync(join(dir, 'other.php'), `<?php echo 'something unrelated'; ?>`);

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      issueIds.some(id => id.includes('truly-orphan.php')),
      `truly-orphan.php (not referenced anywhere) must be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Precision reference floor tests ---

test('rule 2 exact: load_part("stat-strip") → parts/stat-strip.php NOT flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-rule2-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'stat-strip.php'), '<?php // stat-strip ?>');
    writeFileSync(join(dir, 'loader.php'), `<?php $this->load_part('stat-strip', $data); ?>`);

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      !issueIds.some(id => id.includes('stat-strip.php')),
      `stat-strip.php (load_part exact stem match) must NOT be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 1 require: require __DIR__ . "/nav.php" → parts/nav.php NOT flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-rule1-require-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'nav.php'), '<?php // nav ?>');
    writeFileSync(join(dir, 'loader.php'), `<?php require __DIR__ . '/nav.php'; ?>`);

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      !issueIds.some(id => id.includes('parts/nav.php')),
      `nav.php (require path) must NOT be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 1 array: "parts/panel.php" in array → parts/panel.php NOT flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-rule1-array-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'panel.php'), '<?php // panel ?>');
    writeFileSync(join(dir, 'loader.php'), `<?php $parts = ['parts/panel.php', 'other.php']; ?>`);

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      !issueIds.some(id => id.includes('panel.php')),
      `panel.php (listed in array string) must NOT be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stem substring must NOT suppress: bn-profile-field and profile-fields do not mask profile-field.php', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-stem-substr-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'profile-field.php'), '<?php // profile-field ?>');
    // Only contains CSS class substring and pluralised string — no 'profile-field' exact string, no 'profile-field.php'
    writeFileSync(join(dir, 'loader.php'), `<?php echo '<div class="bn-profile-field">'; ?>`);
    writeFileSync(join(dir, 'other.php'), `<?php $label = 'profile-fields'; ?>`);

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      issueIds.some(id => id.includes('profile-field.php')),
      `profile-field.php must be flagged (stem-as-substring must NOT suppress), got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orphan-part.php with no references at all IS flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-orphan-bare-'));
  try {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'parts', 'orphan-part.php'), '<?php // orphan ?>');

    const g = emptyGraph({ free: dir }, new Date().toISOString());
    const result = checkTemplateUsage(g, [dir]);
    const issueIds = result.issues.map(i => i.id);

    assert.ok(
      issueIds.some(id => id.includes('orphan-part.php')),
      `orphan-part.php (no references anywhere) must be flagged, got: ${JSON.stringify(issueIds)}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
