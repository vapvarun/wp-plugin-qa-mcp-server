// src/__tests__/rest-shapes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractShapeKeys, extractJsReads, normalizeMethod } from '../flow/rest-shapes.js';
test('extracts literal response shape keys', () => {
    const php = `function cb(){ return rest_ensure_response(array('items'=>$x,'cursor'=>$c)); }`;
    assert.deepEqual(extractShapeKeys(php).sort(), ['cursor', 'items']);
});
test('flags unresolved dynamic shape', () => {
    const php = `function cb(){ $r = build(); return rest_ensure_response($r); }`;
    assert.deepEqual(extractShapeKeys(php), []);
});
test('extracts JS property reads near a route URL', () => {
    const js = `fetch('/buddynext/v1/feed').then(r=>r.json()).then(d=>{ render(d.items); show(d.cursor); });`;
    const reads = extractJsReads(js, '/buddynext/v1/feed');
    assert.deepEqual(reads.sort(), ['cursor', 'items']);
});
// normalizeMethod
test('normalizeMethod: READABLE -> GET', () => {
    assert.equal(normalizeMethod('READABLE'), 'GET');
});
test('normalizeMethod: EDITABLE -> POST', () => {
    assert.equal(normalizeMethod('EDITABLE'), 'POST');
});
test('normalizeMethod: DELETABLE -> DELETE', () => {
    assert.equal(normalizeMethod('DELETABLE'), 'DELETE');
});
test('normalizeMethod: comma-separated takes first verb', () => {
    assert.equal(normalizeMethod('POST, PUT, PATCH'), 'POST');
});
test('normalizeMethod: already-a-verb passthrough', () => {
    assert.equal(normalizeMethod('GET'), 'GET');
});
// extractShapeKeys scoping: rest_ensure_response present → ignore bare return array
test('extractShapeKeys ignores bare return array when rest_ensure_response present', () => {
    const php = `<?php
function schema(){ return array('type'=>1); }
function cb(){ return rest_ensure_response(array('items'=>$x)); }
`;
    assert.deepEqual(extractShapeKeys(php).sort(), ['items']);
});
// Response-var scoping: non-response obj.prop accesses near the URL must NOT be returned
test('extractJsReads: el.hasAttribute/window.location near URL but not on response var are excluded', () => {
    const js = `
    fetch('/buddynext/v1/items').then(r=>r.json()).then(d=>{
      render(d.items);
      el.hasAttribute('data-loaded');
      window.location.assign('/new');
      btn.disabled = true;
    });
  `;
    const reads = extractJsReads(js, '/buddynext/v1/items');
    assert.ok(reads.includes('items'), 'items (response var prop) should be present');
    assert.ok(!reads.includes('hasAttribute'), 'el.hasAttribute must NOT be returned (not on response var)');
    assert.ok(!reads.includes('location'), 'window.location must NOT be returned (not on response var)');
    assert.ok(!reads.includes('disabled'), 'btn.disabled must NOT be returned (not on response var)');
});
// Destructure pattern: .then(({items, cursor}) => ...) returns those keys directly
test('extractJsReads: destructure pattern returns destructured keys', () => {
    const js = `fetch('/buddynext/v1/feed').then(r=>r.json()).then(({items,cursor})=>{ render(items); show(cursor); });`;
    const reads = extractJsReads(js, '/buddynext/v1/feed');
    assert.deepEqual(reads.sort(), ['cursor', 'items']);
});
// No response binding found → return []
test('extractJsReads: no response binding → returns empty array', () => {
    const js = `doSomething('/buddynext/v1/noop'); el.style.color = 'red';`;
    const reads = extractJsReads(js, '/buddynext/v1/noop');
    assert.deepEqual(reads, []);
});
// Await pattern: const data = await fetch(...).json()
test('extractJsReads: await pattern resolves response var', () => {
    const js = `
    async function load() {
      const res = await fetch('/buddynext/v1/profile').then(r=>r.json());
      showName(res.displayName);
      setAvatar(res.avatarUrl);
    }
  `;
    const reads = extractJsReads(js, '/buddynext/v1/profile');
    assert.ok(reads.includes('displayName'), 'displayName should be present');
    assert.ok(reads.includes('avatarUrl'), 'avatarUrl should be present');
});
//# sourceMappingURL=rest-shapes.test.js.map