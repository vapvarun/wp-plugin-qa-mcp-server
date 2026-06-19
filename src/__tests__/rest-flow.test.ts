// src/__tests__/rest-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkRestFlow } from '../rest-flow-checker.js';

test('flags JS read of a key the route never returns, and dead output', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  const rid = nodeId('route','GET /buddynext/v1/feed');
  addNode(g, { id: rid, kind:'route', name:'GET /buddynext/v1/feed', file:'F.php', line:0, repo:'free', meta:{ shapeKeys:['items','cursor'], shapeUnresolved:false } });
  const c = nodeId('jsConsumer','feed.js:GET /buddynext/v1/feed:courses');
  addNode(g, { id:c, kind:'jsConsumer', name:'courses', file:'feed.js', line:3, repo:'free', meta:{ prop:'courses' } });
  addEdge(g, { from:c, to:rid, kind:'reads', file:'feed.js', line:3, meta:{ prop:'courses' } });
  const r = checkRestFlow(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.some(i => i.startsWith('rest-flow:broken-read')), 'broken read flagged');
  assert.ok(ids.some(i => i.startsWith('rest-flow:dead-output')), 'unread keys flagged');
});
