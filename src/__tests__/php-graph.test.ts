// src/__tests__/php-graph.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, inbound, nodeId } from '../flow/graph.js';
import { ingestPhpFacts } from '../flow/php-graph.js';

const facts = {
  symbols: [
    { kind: 'function', name: 'sample_helper', class: null, fqn: 'sample_helper', file: 'a.php', line: 1, bodyHash: 'h1', params: ['x'], visibility: null, abstract: false },
    { kind: 'method', name: 'render', class: 'Sample\\Widget', fqn: 'Sample\\Widget::render', file: 'a.php', line: 5, bodyHash: 'h2', params: [], visibility: 'public', abstract: false },
    { kind: 'method', name: 'latest', class: 'Sample\\Widget', fqn: 'Sample\\Widget::latest', file: 'a.php', line: 9, bodyHash: 'h3', params: [], visibility: 'public', abstract: false },
  ],
  calls: [
    { fromFqn: 'Sample\\Widget', toName: 'sample_helper', viaService: null, file: 'a.php', line: 6 },
    { fromFqn: 'Sample\\Widget', toName: 'latest', viaService: 'feed', file: 'a.php', line: 7 },
    // top-level / global-scope call (fromFqn: null) — must NOT produce a self-loop
    { fromFqn: null, toName: 'sample_helper', viaService: null, file: 'b.php', line: 3 },
    // FQN-qualified method call (from $this->latest() after sidecar name resolution)
    { fromFqn: 'Sample\\Widget::render', toName: 'Sample\\Widget::latest', viaService: null, file: 'a.php', line: 10 },
  ],
  registrations: [{ hook: 'init', callback: 'Sample\\Widget::render', mechanism: 'add_action', file: 'a.php', line: 12 }],
  serviceBindings: [{ id: 'feed', class: 'Sample\\Widget', file: 'a.php', line: 14 }],
  hooksFired: [{ hook: 'bn_init', file: 'a.php', line: 20 }],
  templatesLoaded: [{ template: 'widget/card', argKeys: ['item'], file: 'a.php', line: 22 }],
  errors: [],
};

test('service-locator call resolves to bound class method; registration marks method consumed', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  ingestPhpFacts(g, facts as any, 'free');
  const latest = nodeId('method', 'Sample\\Widget::latest');
  assert.ok(inbound(g, latest, ['calls']).length >= 1, 'feed->latest resolved to Widget::latest');
  const render = nodeId('method', 'Sample\\Widget::render');
  assert.ok(inbound(g, render, ['registers']).length === 1, 'render consumed via add_action');
});

test('FQN-qualified method call (toName contains ::) resolves to inbound calls edge on the target method', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  ingestPhpFacts(g, facts as any, 'free');
  const latest = nodeId('method', 'Sample\\Widget::latest');
  // The call { toName: 'Sample\\Widget::latest', viaService: null } must add a calls edge
  // that arrives at the method node — distinct from the service-locator path.
  const inboundCalls = inbound(g, latest, ['calls']);
  assert.ok(inboundCalls.length >= 1, 'Sample\\Widget::latest has at least one inbound calls edge');
  // Specifically check the edge from Widget::render (the $this->latest() call)
  const renderFrom = nodeId('method', 'Sample\\Widget::render');
  assert.ok(inboundCalls.some(e => e.from === renderFrom), 'Widget::render -> Widget::latest edge exists via :: resolution');
});

test('no self-loop edges in graph after ingestPhpFacts', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  ingestPhpFacts(g, facts as any, 'free');
  for (const edge of g.edges) {
    assert.notEqual(edge.from, edge.to, `self-loop edge found: from=${edge.from} to=${edge.to} kind=${edge.kind}`);
  }
});

test('global-scope call (fromFqn: null) routes from <global> synthetic node, not self-loop', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  ingestPhpFacts(g, facts as any, 'free');
  const globalId = nodeId('function', '<global>');
  const helperTarget = nodeId('function', 'sample_helper');
  // The edge from global scope must use the synthetic <global> node as from
  const globalEdges = g.edges.filter(e => e.from === globalId && e.to === helperTarget && e.kind === 'calls');
  assert.ok(globalEdges.length >= 1, `expected a calls edge from ${globalId} to ${helperTarget}`);
  // Sanity: the <global> node must exist in the graph
  assert.ok(g.nodes[globalId] !== undefined, '<global> synthetic node must be present in g.nodes');
});
