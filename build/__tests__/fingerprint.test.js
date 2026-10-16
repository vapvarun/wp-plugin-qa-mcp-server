import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintFiles, diffFingerprints } from '../flow/fingerprint.js';
test('diff reports added, modified, deleted', () => {
    const prev = { 'a.php': 'h1', 'b.php': 'h2' };
    const next = { 'a.php': 'h1', 'b.php': 'h2-mod', 'c.php': 'h3' };
    const { changed, deleted } = diffFingerprints(prev, next);
    assert.deepEqual(changed.sort(), ['b.php', 'c.php']);
    assert.deepEqual(deleted, []);
});
test('diff reports deletion', () => {
    const { deleted } = diffFingerprints({ 'x.php': 'h' }, {});
    assert.deepEqual(deleted, ['x.php']);
});
test('fingerprintFiles: path-sensitive, deterministic, keys are relPaths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-test-'));
    try {
        // Two files with IDENTICAL content at DIFFERENT relative paths
        mkdirSync(join(dir, 'a'));
        mkdirSync(join(dir, 'b'));
        const content = '<?php echo "hello"; ?>';
        const pathA = join(dir, 'a', 'foo.php');
        const pathB = join(dir, 'b', 'foo.php');
        writeFileSync(pathA, content);
        writeFileSync(pathB, content);
        const result = fingerprintFiles([pathA, pathB], dir);
        // Keys are relative paths
        assert.deepEqual(Object.keys(result).sort(), ['a/foo.php', 'b/foo.php']);
        // Same content at different paths → different hashes (relPath is part of hash)
        assert.notEqual(result['a/foo.php'], result['b/foo.php'], 'hashes must differ when relPath differs even if content is identical');
        // Determinism: second call yields identical hashes
        const result2 = fingerprintFiles([pathA, pathB], dir);
        assert.equal(result['a/foo.php'], result2['a/foo.php']);
        assert.equal(result['b/foo.php'], result2['b/foo.php']);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=fingerprint.test.js.map