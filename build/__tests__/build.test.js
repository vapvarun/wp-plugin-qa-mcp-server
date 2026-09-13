// src/__tests__/build.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../flow/build.js';
test('builds a graph over the BN free repo with routes, functions, templates', () => {
    const g = buildGraph({ freeRoot: '/Users/vapvarun/dev/repos/buddynext', generated: 't' });
    const nodes = Object.values(g.nodes);
    assert.ok(nodes.some(n => n.kind === 'function'), 'has functions');
    assert.ok(nodes.some(n => n.kind === 'route'), 'has routes');
    assert.ok(nodes.some(n => n.kind === 'template'), 'has templates');
    assert.ok(Object.keys(g.fingerprints).length > 100, 'fingerprinted many files');
    assert.ok(nodes.some(n => n.kind === 'function' && n.name === 'buddynext_get_template'), 'buddynext_get_template found (buddynext.php was scanned)');
    assert.ok(Object.values(g.nodes).some(n => (n.kind === 'method' || n.kind === 'function') &&
        typeof n.file === 'string' &&
        n.file.startsWith('includes/')), 'method/function file paths are repo-root-relative (start with includes/)');
});
//# sourceMappingURL=build.test.js.map