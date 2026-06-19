// src/__tests__/rest-shapes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractShapeKeys, extractJsReads } from '../flow/rest-shapes.js';

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
