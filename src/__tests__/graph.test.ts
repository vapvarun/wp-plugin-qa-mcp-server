import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeId, emptyGraph, addNode, addEdge, inbound, outbound, nodesByKind } from '../flow/graph.js';

test('stable node ids and edge queries', () => {
  const g = emptyGraph({ free: '/free' }, '2026-01-01T00:00:00Z');
  const a = nodeId('function', 'foo'), b = nodeId('function', 'bar');
  assert.equal(a, 'function:foo');
  addNode(g, { id: a, kind: 'function', name: 'foo', file: 'a.php', line: 1, repo: 'free' });
  addNode(g, { id: b, kind: 'function', name: 'bar', file: 'b.php', line: 2, repo: 'free' });
  addEdge(g, { from: b, to: a, kind: 'calls', file: 'b.php', line: 3 });
  assert.equal(nodesByKind(g, 'function').length, 2);
  assert.equal(inbound(g, a, ['calls']).length, 1, 'foo has 1 inbound call');
  assert.equal(inbound(g, b, ['calls']).length, 0, 'bar has 0 inbound calls');
  assert.equal(outbound(g, b).length, 1);
});

test('addNode dedups by id', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: 'function:x', kind: 'function', name: 'x', file: 'a', line: 1, repo: 'free' });
  addNode(g, { id: 'function:x', kind: 'function', name: 'x', file: 'a', line: 9, repo: 'free' });
  assert.equal(Object.keys(g.nodes).length, 1);
  assert.equal(g.nodes['function:x'].line, 9);
});
