// src/__tests__/rest-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkRestFlow } from '../rest-flow-checker.js';
test('flags JS read of a key the route never returns, but does NOT emit dead-output warnings', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    const rid = nodeId('route', 'GET /buddynext/v1/feed');
    addNode(g, { id: rid, kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: { shapeKeys: ['items', 'cursor'], shapeUnresolved: false } });
    const c = nodeId('jsConsumer', 'feed.js:GET /buddynext/v1/feed:courses');
    addNode(g, { id: c, kind: 'jsConsumer', name: 'courses', file: 'feed.js', line: 3, repo: 'free', meta: { prop: 'courses' } });
    addEdge(g, { from: c, to: rid, kind: 'reads', file: 'feed.js', line: 3, meta: { prop: 'courses' } });
    const r = checkRestFlow(g);
    const ids = r.issues.map(i => i.id);
    // broken-read is still flagged (pinpoint, deterministic)
    assert.ok(ids.some(i => i.startsWith('rest-flow:broken-read')), 'broken read flagged');
    // dead-output must NOT be emitted
    assert.ok(!ids.some(i => i.startsWith('rest-flow:dead-output')), 'dead-output NOT emitted');
});
test('multiple shape-unresolved routes → exactly 1 summary info, not per-route', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/dynamic'), kind: 'route', name: 'GET /buddynext/v1/dynamic', file: 'D.php', line: 0, repo: 'free', meta: { shapeUnresolved: true } });
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/other'), kind: 'route', name: 'GET /buddynext/v1/other', file: 'O.php', line: 0, repo: 'free', meta: { shapeUnresolved: true } });
    const r = checkRestFlow(g);
    const unresolvedIssues = r.issues.filter(i => i.id.startsWith('rest-flow:shape-unresolved'));
    assert.strictEqual(unresolvedIssues.length, 1, 'exactly 1 shape-unresolved summary for multiple unresolved routes');
    assert.strictEqual(unresolvedIssues[0].id, 'rest-flow:shape-unresolved-summary', 'id is shape-unresolved-summary');
    assert.strictEqual(unresolvedIssues[0].type, 'info', 'type is info');
    assert.ok(unresolvedIssues[0].title.startsWith('2 routes'), 'title shows count');
    assert.ok(unresolvedIssues[0].message.includes('GET /buddynext/v1/dynamic'), 'message lists route names');
    assert.ok(!r.issues.some(i => i.id.startsWith('rest-flow:broken-read')), 'no broken-read for unresolved shapes');
    assert.ok(!r.issues.some(i => i.id.startsWith('rest-flow:dead-output')), 'no dead-output for unresolved shapes');
});
test('shape-unresolved route: 0 broken-read issues; summary failed count is 0', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/dynamic'), kind: 'route', name: 'GET /buddynext/v1/dynamic', file: 'D.php', line: 0, repo: 'free', meta: { shapeUnresolved: true } });
    const r = checkRestFlow(g);
    assert.strictEqual(r.failed, 0, 'failed is 0 for unresolved-only routes');
});
test('0 shape-unresolved routes → no summary issue emitted', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    const rid = nodeId('route', 'GET /buddynext/v1/resolved');
    addNode(g, { id: rid, kind: 'route', name: 'GET /buddynext/v1/resolved', file: 'R.php', line: 0, repo: 'free', meta: { shapeKeys: ['id', 'name'], shapeUnresolved: false } });
    const r = checkRestFlow(g);
    assert.ok(!r.issues.some(i => i.id.startsWith('rest-flow:shape-unresolved')), 'no summary when all shapes resolved');
});
test('summary message shows +K more when unresolved routes exceed 30', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    for (let i = 0; i < 35; i++) {
        addNode(g, { id: nodeId('route', `GET /route/${i}`), kind: 'route', name: `GET /route/${i}`, file: 'X.php', line: 0, repo: 'free', meta: { shapeUnresolved: true } });
    }
    const r = checkRestFlow(g);
    const summary = r.issues.find(i => i.id === 'rest-flow:shape-unresolved-summary');
    assert.ok(summary, 'summary emitted');
    assert.ok(summary.message.includes('+5 more'), 'message shows +5 more for 35 routes');
    assert.ok(summary.title.startsWith('35 routes'), 'title shows count 35');
});
test('broken-read per-key findings are still emitted alongside summary (pinpoint preserved)', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    const resolved = nodeId('route', 'GET /buddynext/v1/feed');
    addNode(g, { id: resolved, kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: { shapeKeys: ['items'], shapeUnresolved: false } });
    const unresolved = nodeId('route', 'GET /buddynext/v1/dynamic');
    addNode(g, { id: unresolved, kind: 'route', name: 'GET /buddynext/v1/dynamic', file: 'D.php', line: 0, repo: 'free', meta: { shapeUnresolved: true } });
    const c = nodeId('jsConsumer', 'feed.js:GET /buddynext/v1/feed:missing');
    addNode(g, { id: c, kind: 'jsConsumer', name: 'missing', file: 'feed.js', line: 3, repo: 'free', meta: { prop: 'missing' } });
    addEdge(g, { from: c, to: resolved, kind: 'reads', file: 'feed.js', line: 3, meta: { prop: 'missing' } });
    const r = checkRestFlow(g);
    const ids = r.issues.map(i => i.id);
    // broken-read still pinpoint
    assert.ok(ids.some(i => i.startsWith('rest-flow:broken-read')), 'broken-read still pinpoint');
    // shape-unresolved collapses to one summary
    const unresIssues = r.issues.filter(i => i.id.startsWith('rest-flow:shape-unresolved'));
    assert.strictEqual(unresIssues.length, 1, 'exactly 1 shape-unresolved summary');
    assert.strictEqual(unresIssues[0].id, 'rest-flow:shape-unresolved-summary');
});
//# sourceMappingURL=rest-flow.test.js.map