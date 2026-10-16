// src/__tests__/orphan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkOrphans } from '../orphan-checker.js';
import { ingestPhpFacts } from '../flow/php-graph.js';
import { inbound } from '../flow/graph.js';

// ── Precision: single advisory summary, never per-item pile ────────────────

test('5 unreferenced symbols → exactly 1 orphan:summary info finding', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  for (let i = 0; i < 5; i++) {
    addNode(g, { id: nodeId('function', `dead_fn_${i}`), kind: 'function', name: `dead_fn_${i}`, file: 'a.php', line: i + 1, repo: 'free', meta: {} });
  }
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 1, 'exactly 1 issue for 5 unreferenced symbols');
  assert.strictEqual(r.issues[0].id, 'orphan:summary', 'issue id is orphan:summary');
  assert.strictEqual(r.issues[0].type, 'info', 'type is info');
  assert.strictEqual(r.issues[0].severity, 'low', 'severity is low');
  assert.ok(r.issues[0].title.startsWith('5 symbols are unreferenced'), 'title includes count');
  assert.ok(r.issues[0].message.includes('dead_fn_0'), 'message includes candidate names');
  assert.ok(r.issues[0].message.includes('Confirm with runtime coverage'), 'message includes runtime guidance');
  assert.strictEqual(r.failed, 0, 'failed is 0 (advisory, not a failure)');
});

test('0 unreferenced symbols → 0 issues emitted', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  // fn_a calls fn_b and fn_b calls fn_a — both have inbound edges, neither is a candidate
  addNode(g, { id: nodeId('function', 'fn_a'), kind: 'function', name: 'fn_a', file: 'a.php', line: 1, repo: 'free', meta: {} });
  addNode(g, { id: nodeId('function', 'fn_b'), kind: 'function', name: 'fn_b', file: 'b.php', line: 1, repo: 'free', meta: {} });
  addEdge(g, { from: nodeId('function', 'fn_a'), to: nodeId('function', 'fn_b'), kind: 'calls', file: 'a.php', line: 5 });
  addEdge(g, { from: nodeId('function', 'fn_b'), to: nodeId('function', 'fn_a'), kind: 'calls', file: 'b.php', line: 5 });
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 0, 'no issues when all symbols have inbound edges');
});

test('registered callback is not a candidate (no issue emitted)', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('method', 'X::boot'), kind: 'method', name: 'X::boot', file: 'b.php', line: 1, repo: 'free', meta: { short: 'boot' } });
  addNode(g, { id: nodeId('hook', 'init'), kind: 'hook', name: 'init', file: 'b.php', line: 1, repo: 'free' });
  addEdge(g, { from: nodeId('hook', 'init'), to: nodeId('method', 'X::boot'), kind: 'registers', file: 'b.php', line: 1 });
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 0, 'registered callback does not trigger advisory');
});

test('abstract method with zero inbound edges is not a candidate', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('method', 'Base::abstract_method'), kind: 'method', name: 'Base::abstract_method', file: 'a.php', line: 1, repo: 'free', meta: { abstract: true } });
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 0, 'abstract method not included in advisory');
});

test('template with loads edge is not a candidate; orphaned template is included in summary', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('template', 'loaded.php'), kind: 'template', name: 'loaded.php', file: 'a.php', line: 1, repo: 'free', meta: {} });
  addNode(g, { id: nodeId('template', 'orphaned.php'), kind: 'template', name: 'orphaned.php', file: 'b.php', line: 1, repo: 'free', meta: {} });
  addNode(g, { id: nodeId('function', 'include_tpl'), kind: 'function', name: 'include_tpl', file: 'c.php', line: 1, repo: 'free', meta: {} });
  addEdge(g, { from: nodeId('function', 'include_tpl'), to: nodeId('template', 'loaded.php'), kind: 'loads', file: 'c.php', line: 5 });
  const r = checkOrphans(g);
  // orphaned.php and include_tpl (no inbound) both unreferenced → 1 summary
  assert.strictEqual(r.issues.length, 1, 'exactly 1 summary issue');
  assert.ok(r.issues[0].message.includes('orphaned.php'), 'orphaned.php appears in summary message');
  assert.ok(!r.issues[0].message.includes('loaded.php'), 'loaded.php (has loads edge) not in summary');
});

test('function with reads edge is not a candidate', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function', 'global_var'), kind: 'function', name: 'global_var', file: 'a.php', line: 1, repo: 'free', meta: {} });
  addNode(g, { id: nodeId('function', 'consumer'), kind: 'function', name: 'consumer', file: 'b.php', line: 1, repo: 'free', meta: {} });
  addEdge(g, { from: nodeId('function', 'consumer'), to: nodeId('function', 'global_var'), kind: 'reads', file: 'b.php', line: 10 });
  const r = checkOrphans(g);
  // consumer has no inbound → it may be a candidate, but global_var should not be
  const issue = r.issues[0];
  if (issue) {
    assert.ok(!issue.message.includes('global_var'), 'function with reads edge not in summary');
  }
});

// ── Fix 1: name-reference floor ────────────────────────────────────────────────

test('referencedNames floor: method in referencedNames not in summary; unlisted method is in summary', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('method', 'X::handleThing'), kind: 'method', name: 'X::handleThing', file: 'x.php', line: 1, repo: 'free', meta: { short: 'handleThing' } });
  addNode(g, { id: nodeId('method', 'Y::deadOne'), kind: 'method', name: 'Y::deadOne', file: 'y.php', line: 1, repo: 'free', meta: { short: 'deadOne' } });
  g.referencedNames = ['handleThing'];
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 1, 'exactly 1 summary (only Y::deadOne is a candidate)');
  assert.ok(r.issues[0].message.includes('Y::deadOne'), 'Y::deadOne appears in summary');
  assert.ok(!r.issues[0].message.includes('X::handleThing'), 'X::handleThing (in referencedNames) not in summary');
});

test('synthetic <global> and <loader> nodes are never in the summary', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function', '<global>'), kind: 'function', name: '<global>', file: '', line: 0, repo: 'free', meta: { synthetic: true } });
  addNode(g, { id: nodeId('function', '<loader>'), kind: 'function', name: '<loader>', file: '', line: 0, repo: 'free', meta: { synthetic: true } });
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 0, 'synthetic nodes produce no advisory');
});

test('summary message includes +K more when candidates exceed 40', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  for (let i = 0; i < 45; i++) {
    addNode(g, { id: nodeId('function', `fn_${i}`), kind: 'function', name: `fn_${i}`, file: 'a.php', line: i + 1, repo: 'free', meta: {} });
  }
  const r = checkOrphans(g);
  assert.strictEqual(r.issues.length, 1);
  assert.ok(r.issues[0].message.includes('+5 more'), 'message shows +5 more for 45 candidates');
  assert.ok(r.issues[0].title.startsWith('45 symbols'), 'title shows count 45');
});

// ── Fix 1 sidecar integration: $this->foo() adds 'foo' to referencedNames ────

test('ingestPhpFacts: $this->foo() adds foo to g.referencedNames', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  const facts = {
    symbols: [
      { kind: 'method', name: 'foo', class: 'A', fqn: 'A::foo', file: 'a.php', line: 1, bodyHash: 'h', params: [], visibility: 'public', abstract: false },
    ],
    calls: [
      // $this->foo() inside class A — toName is 'A::foo' with viaService:null
      { fromFqn: 'A::bar', toName: 'A::foo', viaService: null, file: 'a.php', line: 5 },
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
      { kind: 'method', name: 'render', class: 'Sample\\Widget', fqn: 'Sample\\Widget::render', file: 'a.php', line: 5, bodyHash: 'h2', params: [], visibility: 'public', abstract: false },
    ],
    calls: [],
    // The sidecar resolves [$this,'render'] inside class Sample\Widget to 'Sample\Widget::render'
    registrations: [{ hook: 'init', callback: 'Sample\\Widget::render', mechanism: 'add_action', file: 'a.php', line: 12 }],
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
