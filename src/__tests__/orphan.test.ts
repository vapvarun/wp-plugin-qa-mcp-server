// src/__tests__/orphan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkOrphans } from '../orphan-checker.js';
import { ingestPhpFacts } from '../flow/php-graph.js';
import { inbound } from '../flow/graph.js';

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

// ── Fix 1: name-reference floor ────────────────────────────────────────────────

test('referencedNames floor: method whose short name is in referencedNames is NOT flagged even with no inbound edge', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  // handleThing: in referencedNames → should be suppressed
  addNode(g, { id: nodeId('method','X::handleThing'), kind:'method', name:'X::handleThing', file:'x.php', line:1, repo:'free', meta:{ short:'handleThing' } });
  // deadOne: NOT in referencedNames → should be flagged
  addNode(g, { id: nodeId('method','Y::deadOne'), kind:'method', name:'Y::deadOne', file:'y.php', line:1, repo:'free', meta:{ short:'deadOne' } });
  g.referencedNames = ['handleThing'];
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(!ids.includes('orphan:method:X::handleThing'), 'method in referencedNames not flagged');
  assert.ok(ids.includes('orphan:method:Y::deadOne'), 'method not in referencedNames is flagged');
});

test('synthetic <global> and <loader> nodes are never emitted as orphan findings', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function','<global>'), kind:'function', name:'<global>', file:'', line:0, repo:'free', meta:{ synthetic:true } });
  addNode(g, { id: nodeId('function','<loader>'), kind:'function', name:'<loader>', file:'', line:0, repo:'free', meta:{ synthetic:true } });
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(!ids.some(i => i.includes('<global>')), '<global> synthetic node not flagged');
  assert.ok(!ids.some(i => i.includes('<loader>')), '<loader> synthetic node not flagged');
});

test('orphan finding has updated pinpoint title and actionable message', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('method','Z::realDead'), kind:'method', name:'Z::realDead', file:'z.php', line:5, repo:'free', meta:{ short:'realDead' } });
  const r = checkOrphans(g);
  const issue = r.issues.find(i => i.id === 'orphan:method:Z::realDead');
  assert.ok(issue, 'issue emitted for Z::realDead');
  assert.ok(issue && issue.title.includes('Dead code:'), 'title uses Dead code: prefix');
  assert.ok(issue && issue.message.includes('Confirmed unreferenced by name'), 'message has confirmation phrase');
  assert.ok(issue && (issue.fix ?? '').includes('Remove it'), 'fix says to remove it');
});

// ── Fix 1 sidecar integration: $this->foo() adds 'foo' to referencedNames ────

test('ingestPhpFacts: $this->foo() adds foo to g.referencedNames', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  const facts = {
    symbols: [
      { kind:'method', name:'foo', class:'A', fqn:'A::foo', file:'a.php', line:1, bodyHash:'h', params:[], visibility:'public', abstract:false },
    ],
    calls: [
      // $this->foo() inside class A — toName is 'A::foo' with viaService:null
      { fromFqn:'A::bar', toName:'A::foo', viaService:null, file:'a.php', line:5 },
    ],
    registrations: [],
    serviceBindings: [],
    hooksFired: [],
    templatesLoaded: [],
    errors: [],
    // Simulate sidecar collecting 'foo' from $this->foo()
    referencedNames: ['foo'],
  };
  ingestPhpFacts(g, facts as any, 'free');
  assert.ok((g.referencedNames ?? []).includes('foo'), 'foo present in g.referencedNames after ingest');
});

test('ingestPhpFacts: [$this, "render"] registration creates registers edge to Sample\\Widget::render', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  const facts = {
    symbols: [
      { kind:'method', name:'render', class:'Sample\\Widget', fqn:'Sample\\Widget::render', file:'a.php', line:5, bodyHash:'h2', params:[], visibility:'public', abstract:false },
    ],
    calls: [],
    // The sidecar resolves [$this,'render'] inside class Sample\Widget to 'Sample\Widget::render'
    registrations: [{ hook:'init', callback:'Sample\\Widget::render', mechanism:'add_action', file:'a.php', line:12 }],
    serviceBindings: [],
    hooksFired: [],
    templatesLoaded: [],
    errors: [],
    referencedNames: ['render'],
  };
  ingestPhpFacts(g, facts as any, 'free');
  const render = nodeId('method', 'Sample\\Widget::render');
  assert.ok(inbound(g, render, ['registers']).length === 1, '[$this,"render"] registration creates registers edge to Sample\\Widget::render');
});
