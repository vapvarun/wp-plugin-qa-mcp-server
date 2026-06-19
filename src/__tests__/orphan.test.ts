// src/__tests__/orphan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkOrphans } from '../orphan-checker.js';

test('flags an uncalled function but not a registered callback', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function','dead_fn'), kind:'function', name:'dead_fn', file:'a.php', line:1, repo:'free', meta:{} });
  addNode(g, { id: nodeId('method','X::boot'), kind:'method', name:'X::boot', file:'b.php', line:1, repo:'free', meta:{ short:'boot' } });
  addNode(g, { id: nodeId('hook','init'), kind:'hook', name:'init', file:'b.php', line:1, repo:'free' });
  addEdge(g, { from: nodeId('hook','init'), to: nodeId('method','X::boot'), kind:'registers', file:'b.php', line:1 });
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.includes('orphan:function:dead_fn'), 'dead_fn is orphan');
  assert.ok(!ids.some(i => i.includes('X::boot')), 'registered callback not orphan');
});
