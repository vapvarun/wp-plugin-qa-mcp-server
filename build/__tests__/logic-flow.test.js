// src/__tests__/logic-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, nodeId } from '../flow/graph.js';
import { checkLogicFlow } from '../logic-flow-checker.js';
test('flags a journey whose entry has no graph route', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/feed'), kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: {} });
    const journeys = [{ id: 'jJoin', name: 'Join a space', entry: '/buddynext/v1/spaces/join' }, { id: 'jFeed', name: 'View feed', entry: '/buddynext/v1/feed' }];
    const r = checkLogicFlow(g, journeys);
    const ids = r.issues.map(i => i.id);
    assert.ok(ids.includes('logic-flow:no-path:jJoin'), 'join journey unresolved');
    assert.ok(!ids.includes('logic-flow:no-path:jFeed'), 'feed journey resolved');
});
test('enforces path-segment boundary matching; prevents /x matching /xyz', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/feed'), kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: {} });
    // Journey with entry /buddynext/v1/fee (prefix of /feed but NOT a segment boundary) should NOT match
    const journeys = [{ id: 'jFee', name: 'Fee route', entry: '/buddynext/v1/fee' }];
    const r = checkLogicFlow(g, journeys);
    const ids = r.issues.map(i => i.id);
    assert.ok(ids.includes('logic-flow:no-path:jFee'), 'non-boundary prefix /fee does not match /feed');
});
test('undocumented routes emit exactly ONE summary finding, not N per-route findings', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/feed'), kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: {} });
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/admin/tools'), kind: 'route', name: 'GET /buddynext/v1/admin/tools', file: 'F.php', line: 0, repo: 'free', meta: {} });
    addNode(g, { id: nodeId('route', 'POST /buddynext/v1/posts'), kind: 'route', name: 'POST /buddynext/v1/posts', file: 'F.php', line: 0, repo: 'free', meta: {} });
    // Only feed is journeyed
    const journeys = [{ id: 'jFeed', name: 'View feed', entry: '/buddynext/v1/feed' }];
    const r = checkLogicFlow(g, journeys);
    const ids = r.issues.map(i => i.id);
    // Exactly one summary finding
    const summaries = ids.filter(i => i === 'logic-flow:undocumented-summary');
    assert.strictEqual(summaries.length, 1, 'exactly one undocumented-summary finding');
    // No per-route undocumented findings
    assert.ok(!ids.some(i => i.startsWith('logic-flow:undocumented:') && i !== 'logic-flow:undocumented-summary'), 'no per-route undocumented findings');
    // no-path warnings still present for unresolved journeys
    assert.ok(!ids.includes('logic-flow:no-path:jFeed'), 'feed journey still resolved');
});
test('summary message includes route count and route paths', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/admin/tools'), kind: 'route', name: 'GET /buddynext/v1/admin/tools', file: 'F.php', line: 0, repo: 'free', meta: {} });
    const r = checkLogicFlow(g, []);
    const summary = r.issues.find(i => i.id === 'logic-flow:undocumented-summary');
    assert.ok(summary, 'summary emitted');
    assert.ok(summary.message.includes('/buddynext/v1/admin/tools'), 'message contains the route path');
    assert.ok(summary.type === 'info', 'summary type is info');
});
test('no undocumented-summary when all routes are matched by journeys', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/feed'), kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: {} });
    const journeys = [{ id: 'jFeed', name: 'View feed', entry: '/buddynext/v1/feed' }];
    const r = checkLogicFlow(g, journeys);
    const ids = r.issues.map(i => i.id);
    assert.ok(!ids.includes('logic-flow:undocumented-summary'), 'no summary when all routes matched');
});
test('no-path warnings still present alongside undocumented summary', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/feed'), kind: 'route', name: 'GET /buddynext/v1/feed', file: 'F.php', line: 0, repo: 'free', meta: {} });
    addNode(g, { id: nodeId('route', 'GET /buddynext/v1/admin/tools'), kind: 'route', name: 'GET /buddynext/v1/admin/tools', file: 'F.php', line: 0, repo: 'free', meta: {} });
    const journeys = [{ id: 'jJoin', name: 'Join', entry: '/buddynext/v1/spaces/join' }];
    const r = checkLogicFlow(g, journeys);
    const ids = r.issues.map(i => i.id);
    assert.ok(ids.includes('logic-flow:no-path:jJoin'), 'no-path warning still present');
    assert.ok(ids.includes('logic-flow:undocumented-summary'), 'undocumented summary also present');
});
//# sourceMappingURL=logic-flow.test.js.map