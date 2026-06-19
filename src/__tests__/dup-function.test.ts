// src/__tests__/dup-function.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, nodeId } from '../flow/graph.js';
import { checkDupFunctions } from '../dup-function-checker.js';

test('flags two functions with identical body hash', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function','a_initials'), kind:'function', name:'a_initials', file:'a.php', line:1, repo:'free', meta:{ bodyHash:'SAME', short:'a_initials' } });
  addNode(g, { id: nodeId('function','b_initials'), kind:'function', name:'b_initials', file:'b.php', line:1, repo:'free', meta:{ bodyHash:'SAME', short:'b_initials' } });
  addNode(g, { id: nodeId('function','c_unique'), kind:'function', name:'c_unique', file:'c.php', line:1, repo:'free', meta:{ bodyHash:'OTHER', short:'c_unique' } });
  const r = checkDupFunctions(g);
  assert.equal(r.failed, 1, 'one dup cluster');
  assert.match(r.issues[0].message, /a_initials|b_initials/);
});
