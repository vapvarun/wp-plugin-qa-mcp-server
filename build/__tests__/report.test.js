// src/__tests__/report.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../flow/report.js';
test('renders grouped markdown with counts', () => {
    const md = renderReport([{ category: 'dup-function', issues: [{ id: 'dup:A', severity: 'high', type: 'error', title: 'Duplicate', message: 'm', file: 'a.php', line: 1 }], passed: 5, failed: 1, skipped: 0, duration: 1 }], { generated: 't', repos: ['free'] });
    assert.match(md, /dup-function/);
    assert.match(md, /Duplicate/);
    assert.match(md, /1 error|failed/i);
});
//# sourceMappingURL=report.test.js.map