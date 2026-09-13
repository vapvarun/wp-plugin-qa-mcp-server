// src/__tests__/baseline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseline } from '../flow/baseline.js';
test('drops suppressed ids', () => {
    const issues = [{ id: 'dup:AAA' }, { id: 'orphan:function:x' }];
    const kept = applyBaseline(issues, { suppressions: [{ id: 'dup:AAA', reason: 'verified intentional' }] });
    assert.deepEqual(kept.map((i) => i.id), ['orphan:function:x']);
});
//# sourceMappingURL=baseline.test.js.map