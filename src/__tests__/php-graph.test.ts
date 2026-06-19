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
  ],
  registrations: [{ hook: 'init', callback: 'Sample\\Widget::render', mechanism: 'add_action', file: 'a.php', line: 12 }],
  serviceBindings: [{ id: 'feed', class: 'Sample\\Widget', file: 'a.php', line: 14 }],
  hooksFired: [], templatesLoaded: [], errors: [],
};

test('service-locator call resolves to bound class method; registration marks method consumed', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  ingestPhpFacts(g, facts as any, 'free');
  const latest = nodeId('method', 'Sample\\Widget::latest');
  assert.ok(inbound(g, latest, ['calls']).length >= 1, 'feed->latest resolved to Widget::latest');
  const render = nodeId('method', 'Sample\\Widget::render');
  assert.ok(inbound(g, render, ['registers']).length === 1, 'render consumed via add_action');
});
