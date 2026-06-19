// src/__tests__/logic-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, nodeId } from '../flow/graph.js';
import { checkLogicFlow } from '../logic-flow-checker.js';

test('flags a journey whose entry has no graph route', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('route','GET /buddynext/v1/feed'), kind:'route', name:'GET /buddynext/v1/feed', file:'F.php', line:0, repo:'free', meta:{} });
  const journeys = [{ id:'jJoin', name:'Join a space', entry:'/buddynext/v1/spaces/join' }, { id:'jFeed', name:'View feed', entry:'/buddynext/v1/feed' }];
  const r = checkLogicFlow(g, journeys);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.includes('logic-flow:no-path:jJoin'), 'join journey unresolved');
  assert.ok(!ids.includes('logic-flow:no-path:jFeed'), 'feed journey resolved');
});

test('enforces path-segment boundary matching; prevents /x matching /xyz', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('route','GET /buddynext/v1/feed'), kind:'route', name:'GET /buddynext/v1/feed', file:'F.php', line:0, repo:'free', meta:{} });
  // Journey with entry /buddynext/v1/fee (prefix of /feed but NOT a segment boundary) should NOT match
  const journeys = [{ id:'jFee', name:'Fee route', entry:'/buddynext/v1/fee' }];
  const r = checkLogicFlow(g, journeys);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.includes('logic-flow:no-path:jFee'), 'non-boundary prefix /fee does not match /feed');
});

test('covers undocumented-route branch; flags routes with no journey and exempts matched routes', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('route','GET /buddynext/v1/feed'), kind:'route', name:'GET /buddynext/v1/feed', file:'F.php', line:0, repo:'free', meta:{} });
  addNode(g, { id: nodeId('route','GET /buddynext/v1/admin/tools'), kind:'route', name:'GET /buddynext/v1/admin/tools', file:'F.php', line:0, repo:'free', meta:{} });
  const journeys = [{ id:'jFeed', name:'View feed', entry:'/buddynext/v1/feed' }];
  const r = checkLogicFlow(g, journeys);
  const ids = r.issues.map(i => i.id);
  // /feed is matched by jFeed, so no undocumented issue for it
  assert.ok(!ids.includes('logic-flow:undocumented:/buddynext/v1/feed'), 'matched route is not flagged as undocumented');
  // /admin/tools has no journey entry matching it, so it should be flagged
  assert.ok(ids.includes('logic-flow:undocumented:/buddynext/v1/admin/tools'), 'unmatched route flagged as undocumented');
});
