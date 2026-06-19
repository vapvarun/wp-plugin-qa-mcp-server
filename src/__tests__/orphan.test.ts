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

test('abstract method with zero inbound edges is not flagged', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('method','Base::abstract_method'), kind:'method', name:'Base::abstract_method', file:'a.php', line:1, repo:'free', meta:{ abstract:true } });
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(!ids.includes('orphan:method:Base::abstract_method'), 'abstract method not flagged as orphan');
});

test('template with loads edge is not flagged, but template without loads is flagged', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('template','loaded.php'), kind:'template', name:'loaded.php', file:'a.php', line:1, repo:'free', meta:{} });
  addNode(g, { id: nodeId('template','orphaned.php'), kind:'template', name:'orphaned.php', file:'b.php', line:1, repo:'free', meta:{} });
  addNode(g, { id: nodeId('function','include_tpl'), kind:'function', name:'include_tpl', file:'c.php', line:1, repo:'free', meta:{} });
  addEdge(g, { from: nodeId('function','include_tpl'), to: nodeId('template','loaded.php'), kind:'loads', file:'c.php', line:5 });
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(!ids.includes('orphan:template:loaded.php'), 'template with loads edge not flagged');
  assert.ok(ids.includes('orphan:template:orphaned.php'), 'template without loads edge is flagged');
});

test('function with reads edge is not flagged', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function','global_var'), kind:'function', name:'global_var', file:'a.php', line:1, repo:'free', meta:{} });
  addNode(g, { id: nodeId('function','consumer'), kind:'function', name:'consumer', file:'b.php', line:1, repo:'free', meta:{} });
  addEdge(g, { from: nodeId('function','consumer'), to: nodeId('function','global_var'), kind:'reads', file:'b.php', line:10 });
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(!ids.includes('orphan:function:global_var'), 'function with reads edge not flagged');
});
