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

// extractJsReads noise exclusions
test('extractJsReads excludes noise props like status', () => {
  const js = `fetch('/buddynext/v1/items').then(r=>{ if(r.status===200) return r.json(); }).then(d=>{ render(d.items); });`;
  const reads = extractJsReads(js, '/buddynext/v1/items');
  assert.ok(reads.includes('items'), 'items should be present');
  assert.ok(!reads.includes('status'), 'status should be excluded');
});

// DOM / JS-API noise exclusions
test('extractJsReads: DOM/JS-API props excluded, real response props kept', () => {
  const js = `
    fetch('/buddynext/v1/members').then(r=>r.json()).then(d=>{
      render(d.items);
      el.hasAttribute('data-loaded');
      node.removeAttribute('aria-busy');
      node.setAttribute('aria-live','polite');
      btn.disabled = true;
      cb.checked = false;
      url.replace('/old','/new');
      location.assign('/new-page');
      location.reload();
      const h = location.hash;
      const s = location.search;
      const ho = location.host;
      const hr = location.href;
      const pe = el.parentElement;
      const ns = el.nextElementSibling;
      const ps = el.previousElementSibling;
      parent.insertBefore(newEl, ref);
      parent.appendChild(child);
      parent.removeChild(child);
      ul.contains(li);
      el.matches('.active');
      el.scrollIntoView({ behavior:'smooth' });
      el.getBoundingClientRect();
      el.cloneNode(true);
    });
  `;
  const reads = extractJsReads(js, '/buddynext/v1/members');
  assert.ok(reads.includes('items'), 'items should be present');
  const domProps = ['hasAttribute','removeAttribute','setAttribute','disabled','checked',
    'replace','assign','reload','location','hash','search','host','href',
    'parentElement','nextElementSibling','previousElementSibling',
    'insertBefore','appendChild','removeChild','contains','matches',
    'scrollIntoView','getBoundingClientRect','cloneNode'];
  for (const p of domProps) {
    assert.ok(!reads.includes(p), `DOM/JS-API prop "${p}" must be excluded`);
  }
});
