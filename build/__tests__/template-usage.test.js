// src/__tests__/template-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isEntrypoint, checkTemplateUsage } from '../template-usage-checker.js';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
// Helpers to create a minimal test repo tree
function makeRepo(dir, phpContent = '') {
    mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
    // assets/js for JS source (optional)
    if (phpContent)
        writeFileSync(join(dir, 'loader.php'), phpContent);
}
test('parts are not entrypoints; top-level page templates are', () => {
    assert.equal(isEntrypoint('templates/parts/post-card.php'), false);
    assert.equal(isEntrypoint('templates/feed/home.php'), true);
    assert.equal(isEntrypoint('templates/members.php'), true);
});
// --- Single-advisory emission tests ---
test('checkTemplateUsage: multiple unloaded templates → AT MOST ONE tpl-usage:unloaded-summary issue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-usage-summary-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'orphan-a.php'), '<?php // a ?>');
        writeFileSync(join(dir, 'templates', 'parts', 'orphan-b.php'), '<?php // b ?>');
        writeFileSync(join(dir, 'templates', 'parts', 'orphan-c.php'), '<?php // c ?>');
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        // Must emit at most ONE issue regardless of how many candidates exist
        assert.ok(result.issues.length <= 1, `Expected at most 1 issue, got ${result.issues.length}: ${JSON.stringify(result.issues.map(i => i.id))}`);
        // That single issue must be the summary advisory
        if (result.issues.length === 1) {
            assert.equal(result.issues[0].id, 'tpl-usage:unloaded-summary', `Expected id 'tpl-usage:unloaded-summary', got '${result.issues[0].id}'`);
            assert.equal(result.issues[0].type, 'info');
            assert.equal(result.issues[0].severity, 'low');
            const summary = result.issues[0];
            assert.ok(summary.title.includes('3 templates'), `title should mention count, got: ${summary.title}`);
            assert.ok(summary.message.includes('NOT a confirmed dead-template'), `message should disclaim false positives`);
            assert.ok(summary.message.includes('computed name'), `message should mention computed name loading`);
            assert.ok((summary.fix ?? '').includes('Do not bulk-delete'), `fix should warn against bulk-delete`);
            assert.equal(result.failed, 0);
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('checkTemplateUsage: zero candidates → zero issues emitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-usage-zero-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'post-card.php'), '<?php // post-card ?>');
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const postCardId = nodeId('template', 'parts/post-card.php');
        addNode(g, { id: postCardId, kind: 'template', name: 'parts/post-card.php', file: 'templates/parts/post-card.php', line: 1, repo: 'free' });
        const loaderId = nodeId('route', 'feed-home');
        addNode(g, { id: loaderId, kind: 'route', name: 'feed-home', file: 'src/feed.php', line: 1, repo: 'free' });
        addEdge(g, { from: loaderId, to: postCardId, kind: 'loads', file: 'src/feed.php', line: 10 });
        const result = checkTemplateUsage(g, [dir]);
        assert.equal(result.issues.length, 0, `Expected 0 issues when all templates are loaded, got: ${JSON.stringify(result.issues.map(i => i.id))}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('checkTemplateUsage: loaded part not included in summary, bare-suffix distractor does not suppress', () => {
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
        //            → orphan-widget WRONGLY suppressed → summary candidate list WRONG
        //   FIXED arm `nameForLoader.endsWith('/' + l)` → endsWith('/widget.php') = FALSE
        //            → orphan-widget correctly appears as a candidate in the summary
        const distractorId = nodeId('template', 'widget.php');
        addNode(g, { id: distractorId, kind: 'template', name: 'widget.php', file: 'templates/widget.php', line: 1, repo: 'free' });
        const distractorLoaderId = nodeId('route', 'distractor-loader');
        addNode(g, { id: distractorLoaderId, kind: 'route', name: 'distractor-loader', file: 'src/distractor.php', line: 1, repo: 'free' });
        addEdge(g, { from: distractorLoaderId, to: distractorId, kind: 'loads', file: 'src/distractor.php', line: 5 });
        const result = checkTemplateUsage(g, [dir]);
        // Must emit at most ONE issue
        assert.ok(result.issues.length <= 1, `Expected at most 1 issue, got ${result.issues.length}`);
        // orphan-widget should be a candidate (summary emitted), post-card should NOT be a candidate
        if (result.issues.length === 1) {
            const summary = result.issues[0];
            assert.equal(summary.id, 'tpl-usage:unloaded-summary');
            assert.ok(summary.message.includes('orphan-widget.php'), `Summary message should list orphan-widget.php, got: ${summary.message}`);
            assert.ok(!summary.message.includes('post-card.php'), `Summary message must NOT list post-card.php (it is loaded), got: ${summary.message}`);
        }
        else {
            // No summary means no candidates — but orphan-widget should be one; something is wrong
            assert.fail('Expected 1 summary issue (orphan-widget.php is a candidate), got 0');
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('checkTemplateUsage: template whose basename appears in a PHP string literal is NOT a candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-reffloor-test-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'dynamic-card.php'), '<?php // dynamic ?>');
        // A PHP source file that references the template basename via a string literal (dynamic load)
        writeFileSync(join(dir, 'loader.php'), `<?php buddynext_get_template( $prefix . 'dynamic-card.php' ); ?>`);
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        // dynamic-card.php is in a string literal → not a candidate → no summary emitted
        assert.equal(result.issues.length, 0, `dynamic-card.php (basename in string literal) must NOT be a candidate, got issues: ${JSON.stringify(result.issues.map(i => i.id))}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('checkTemplateUsage: template with no reference IS included in summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-reffloor-nowhere-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'truly-orphan.php'), '<?php // orphan ?>');
        // No PHP/JS source references 'truly-orphan.php' anywhere
        writeFileSync(join(dir, 'other.php'), `<?php echo 'something unrelated'; ?>`);
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        // Must emit exactly 1 summary advisory
        assert.equal(result.issues.length, 1, `Expected 1 summary issue, got: ${JSON.stringify(result.issues.map(i => i.id))}`);
        assert.equal(result.issues[0].id, 'tpl-usage:unloaded-summary');
        assert.ok(result.issues[0].message.includes('truly-orphan.php'), `Summary should list truly-orphan.php, got: ${result.issues[0].message}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
// --- Precision reference floor tests (verify detection logic unchanged) ---
test('rule 2 exact: load_part("stat-strip") → parts/stat-strip.php NOT a candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-rule2-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'stat-strip.php'), '<?php // stat-strip ?>');
        writeFileSync(join(dir, 'loader.php'), `<?php $this->load_part('stat-strip', $data); ?>`);
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        assert.equal(result.issues.length, 0, `stat-strip.php (load_part exact stem match) must NOT be a candidate, got: ${JSON.stringify(result.issues.map(i => i.id))}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('rule 1 require: require __DIR__ . "/nav.php" → parts/nav.php NOT a candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-rule1-require-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'nav.php'), '<?php // nav ?>');
        writeFileSync(join(dir, 'loader.php'), `<?php require __DIR__ . '/nav.php'; ?>`);
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        assert.equal(result.issues.length, 0, `nav.php (require path) must NOT be a candidate, got: ${JSON.stringify(result.issues.map(i => i.id))}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('rule 1 array: "parts/panel.php" in array → parts/panel.php NOT a candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-rule1-array-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'panel.php'), '<?php // panel ?>');
        writeFileSync(join(dir, 'loader.php'), `<?php $parts = ['parts/panel.php', 'other.php']; ?>`);
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        assert.equal(result.issues.length, 0, `panel.php (listed in array string) must NOT be a candidate, got: ${JSON.stringify(result.issues.map(i => i.id))}`);
    }
    finally {
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
        // profile-field.php must be a candidate → summary emitted
        assert.equal(result.issues.length, 1, `Expected 1 summary issue (profile-field.php is a candidate), got: ${JSON.stringify(result.issues.map(i => i.id))}`);
        assert.equal(result.issues[0].id, 'tpl-usage:unloaded-summary');
        assert.ok(result.issues[0].message.includes('profile-field.php'), `Summary must mention profile-field.php, got: ${result.issues[0].message}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('orphan-part.php with no references at all IS included in summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-orphan-bare-'));
    try {
        mkdirSync(join(dir, 'templates', 'parts'), { recursive: true });
        writeFileSync(join(dir, 'templates', 'parts', 'orphan-part.php'), '<?php // orphan ?>');
        const g = emptyGraph({ free: dir }, new Date().toISOString());
        const result = checkTemplateUsage(g, [dir]);
        assert.equal(result.issues.length, 1, `Expected 1 summary issue, got: ${JSON.stringify(result.issues.map(i => i.id))}`);
        assert.equal(result.issues[0].id, 'tpl-usage:unloaded-summary');
        assert.ok(result.issues[0].message.includes('orphan-part.php'), `Summary must list orphan-part.php, got: ${result.issues[0].message}`);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=template-usage.test.js.map