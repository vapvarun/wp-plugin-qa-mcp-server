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

test('excludes Free/Pro override family (same short name, same bodyHash, both methods)', () => {
  const g = emptyGraph({ free: '/free', pro: '/pro' }, 't');
  // Two method nodes with identical short name and identical bodyHash — legitimate override family.
  addNode(g, { id: nodeId('method','MyClass::doThing'), kind:'method', name:'MyClass::doThing', file:'free/MyClass.php', line:10, repo:'free', meta:{ bodyHash:'OVERRIDE_HASH', short:'doThing' } });
  addNode(g, { id: nodeId('method','MyClassPro::doThing'), kind:'method', name:'MyClassPro::doThing', file:'pro/MyClassPro.php', line:10, repo:'pro', meta:{ bodyHash:'OVERRIDE_HASH', short:'doThing' } });
  const r = checkDupFunctions(g);
  assert.equal(r.failed, 0, 'override family must not be flagged');
});

test('flags two methods with same bodyHash but different short names', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  // Same bodyHash but different short names — NOT an override family, should still be flagged.
  addNode(g, { id: nodeId('method','ClassA::alpha'), kind:'method', name:'ClassA::alpha', file:'a.php', line:5, repo:'free', meta:{ bodyHash:'SHARED_HASH', short:'alpha' } });
  addNode(g, { id: nodeId('method','ClassB::beta'), kind:'method', name:'ClassB::beta', file:'b.php', line:5, repo:'free', meta:{ bodyHash:'SHARED_HASH', short:'beta' } });
  const r = checkDupFunctions(g);
  assert.equal(r.failed, 1, 'different short names with same hash must be flagged');
});
