// src/__tests__/php-sidecar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');           // build/__tests__ -> repo root
const sidecar = join(repoRoot, 'php-ast', 'extract-graph.php');
const fixtureDir = join(repoRoot, 'php-ast', '__fixtures__');

test('sidecar extracts functions, methods, calls, registrations, service bindings', () => {
  // -d flags suppress PHP startup extension-load warnings that would corrupt JSON stdout
  const out = execFileSync('php', ['-d', 'display_errors=0', '-d', 'display_startup_errors=0', sidecar, fixtureDir], { encoding: 'utf8' });
  const g = JSON.parse(out);
  const fnNames = g.symbols.filter((s: any) => s.kind === 'function').map((s: any) => s.name);
  assert.ok(fnNames.includes('sample_helper'), 'finds top-level function');
  const method = g.symbols.find((s: any) => s.kind === 'method' && s.name === 'render');
  assert.equal(method.class, 'Sample\\Widget');
  assert.ok(method.bodyHash && method.bodyHash.length === 40, 'method has sha1 bodyHash');
  assert.ok(g.calls.some((c: any) => c.toName === 'sample_helper'), 'records a direct call');
  const helperCall = g.calls.find((c: any) => c.toName === 'sample_helper');
  assert.equal(helperCall?.fromFqn, 'Sample\\Widget::render', 'sample_helper call is attributed to Widget::render method');
  assert.ok(g.calls.some((c: any) => c.viaService === 'feed'), 'records a service-locator call');
  assert.ok(g.registrations.some((r: any) => r.hook === 'init'), 'records add_action registration');
  assert.ok(g.serviceBindings.some((b: any) => b.id === 'feed'), 'records a service binding');
  // New: $this->method() emits fully-qualified call
  assert.ok(
    g.calls.some((c: any) => c.toName === 'Sample\\Widget::latest' && c.viaService === null),
    '$this->latest() in Widget::render emits toName Sample\\Widget::latest',
  );
  // New: ClassName::method() static call emits fully-qualified call
  assert.ok(
    g.calls.some((c: any) => c.toName === 'Sample\\Widget::helper' && c.viaService === null),
    'Widget::helper() static call emits toName Sample\\Widget::helper',
  );
});
