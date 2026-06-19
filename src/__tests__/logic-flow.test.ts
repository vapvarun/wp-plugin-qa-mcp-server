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
