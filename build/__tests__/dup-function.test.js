// src/__tests__/dup-function.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, nodeId } from '../flow/graph.js';
import { checkDupFunctions } from '../dup-function-checker.js';
test('flags two functions with identical body hash', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('function', 'a_initials'), kind: 'function', name: 'a_initials', file: 'a.php', line: 1, repo: 'free', meta: { bodyHash: 'SAME', short: 'a_initials', bodyLen: 120 } });
    addNode(g, { id: nodeId('function', 'b_initials'), kind: 'function', name: 'b_initials', file: 'b.php', line: 1, repo: 'free', meta: { bodyHash: 'SAME', short: 'b_initials', bodyLen: 120 } });
    addNode(g, { id: nodeId('function', 'c_unique'), kind: 'function', name: 'c_unique', file: 'c.php', line: 1, repo: 'free', meta: { bodyHash: 'OTHER', short: 'c_unique', bodyLen: 120 } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 1, 'one dup cluster');
    assert.match(r.issues[0].message, /a_initials|b_initials/);
});
test('excludes Free/Pro override family (same short name, same bodyHash, both methods)', () => {
    const g = emptyGraph({ free: '/free', pro: '/pro' }, 't');
    // Two method nodes with identical short name and identical bodyHash — legitimate override family.
    addNode(g, { id: nodeId('method', 'MyClass::doThing'), kind: 'method', name: 'MyClass::doThing', file: 'free/MyClass.php', line: 10, repo: 'free', meta: { bodyHash: 'OVERRIDE_HASH', short: 'doThing' } });
    addNode(g, { id: nodeId('method', 'MyClassPro::doThing'), kind: 'method', name: 'MyClassPro::doThing', file: 'pro/MyClassPro.php', line: 10, repo: 'pro', meta: { bodyHash: 'OVERRIDE_HASH', short: 'doThing' } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 0, 'override family must not be flagged');
});
test('flags two methods with same bodyHash but different short names', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    // Same bodyHash but different short names — NOT an override family, should still be flagged.
    addNode(g, { id: nodeId('method', 'ClassA::alpha'), kind: 'method', name: 'ClassA::alpha', file: 'a.php', line: 5, repo: 'free', meta: { bodyHash: 'SHARED_HASH', short: 'alpha', bodyLen: 150 } });
    addNode(g, { id: nodeId('method', 'ClassB::beta'), kind: 'method', name: 'ClassB::beta', file: 'b.php', line: 5, repo: 'free', meta: { bodyHash: 'SHARED_HASH', short: 'beta', bodyLen: 150 } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 1, 'different short names with same hash must be flagged');
});
const EMPTY_BODY_HASH = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
test('excludes cluster where all nodes have empty-body hash (empty __construct / abstract stubs)', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('method', 'A::__construct'), kind: 'method', name: 'A::__construct', file: 'a.php', line: 1, repo: 'free', meta: { bodyHash: EMPTY_BODY_HASH, short: '__construct' } });
    addNode(g, { id: nodeId('method', 'B::__construct'), kind: 'method', name: 'B::__construct', file: 'b.php', line: 1, repo: 'free', meta: { bodyHash: EMPTY_BODY_HASH, short: '__construct' } });
    addNode(g, { id: nodeId('method', 'C::__construct'), kind: 'method', name: 'C::__construct', file: 'c.php', line: 1, repo: 'free', meta: { bodyHash: EMPTY_BODY_HASH, short: '__construct' } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 0, 'empty-body cluster must not be flagged');
});
test('still flags cluster with a real shared non-empty hash', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('function', 'fn_x'), kind: 'function', name: 'fn_x', file: 'x.php', line: 1, repo: 'free', meta: { bodyHash: 'abc123def456', short: 'fn_x', bodyLen: 200 } });
    addNode(g, { id: nodeId('function', 'fn_y'), kind: 'function', name: 'fn_y', file: 'y.php', line: 1, repo: 'free', meta: { bodyHash: 'abc123def456', short: 'fn_y', bodyLen: 200 } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 1, 'real shared hash must still be flagged');
});
test('skips cluster where every member has trivial bodyLen (<80)', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('method', 'A::isEnabled'), kind: 'method', name: 'A::isEnabled', file: 'a.php', line: 1, repo: 'free', meta: { bodyHash: 'STUB_HASH', short: 'isEnabled', bodyLen: 12 } });
    addNode(g, { id: nodeId('method', 'B::isEnabled'), kind: 'method', name: 'B::isEnabled', file: 'b.php', line: 1, repo: 'free', meta: { bodyHash: 'STUB_HASH', short: 'isEnabled', bodyLen: 12 } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 0, 'trivial bodyLen cluster must not be flagged');
});
test('flags cluster where at least one member has bodyLen >= 80', () => {
    const g = emptyGraph({ free: '/free' }, 't');
    addNode(g, { id: nodeId('function', 'fn_big_x'), kind: 'function', name: 'fn_big_x', file: 'x.php', line: 1, repo: 'free', meta: { bodyHash: 'BIG_HASH', short: 'fn_big_x', bodyLen: 300 } });
    addNode(g, { id: nodeId('function', 'fn_big_y'), kind: 'function', name: 'fn_big_y', file: 'y.php', line: 1, repo: 'free', meta: { bodyHash: 'BIG_HASH', short: 'fn_big_y', bodyLen: 300 } });
    const r = checkDupFunctions(g);
    assert.equal(r.failed, 1, 'non-trivial bodyLen cluster must be flagged');
});
//# sourceMappingURL=dup-function.test.js.map