import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkScale } from '../perf-scale-checker.js';
function put(root, rel, content) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
}
const mf = (root) => ({ pluginPath: root });
const codes = (root) => checkScale(mf(root)).issues.map(i => i.code);
describe('perf-scale-checker', () => {
    let root;
    after(() => { if (root)
        rmSync(root, { recursive: true, force: true }); });
    it('degrades to skipped when there are no tables and no $wpdb', () => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-ps-none-'));
        put(root, 'plugin.php', `<?php function foo(){ return get_option('x'); }`);
        const r = checkScale(mf(root));
        assert.equal(r.skipped, 1);
        assert.equal(r.issues.length, 0);
    });
    it('flags an unindexed WHERE column (RED) but not an indexed one (GREEN)', () => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-ps-idx-'));
        // `status` is indexed; `author_id` is a real column but NOT indexed.
        put(root, 'schema.php', `<?php
    $sql = "CREATE TABLE {$wpdb->prefix}acme_items (
      id bigint(20) NOT NULL AUTO_INCREMENT,
      status varchar(20) NOT NULL,
      author_id bigint(20) NOT NULL,
      PRIMARY KEY (id),
      KEY status (status)
    )";`);
        put(root, 'repo.php', `<?php
    global $wpdb;
    $a = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}acme_items WHERE status = 'x' LIMIT 10" );
    $b = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}acme_items WHERE author_id = 5 LIMIT 10" );`);
        const c = codes(root);
        assert.ok(c.includes('missing-index'), 'author_id should be flagged');
        // Exactly one missing-index (author_id), not status.
        assert.equal(c.filter(x => x === 'missing-index').length, 1);
    });
    it('flags a query inside a loop as N+1 (RED) but not one outside (GREEN)', () => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-ps-nplus-'));
        put(root, 'loop.php', `<?php
    foreach ( $ids as $id ) {
      $meta = get_post_meta( $id, 'k', true );
      echo $meta;
    }
    $once = get_post_meta( 7, 'k', true );`);
        const c = codes(root);
        assert.equal(c.filter(x => x === 'n-plus-one').length, 1);
    });
    it('flags an unbounded multi-row read but not a LIMITed one', () => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-ps-unb-'));
        put(root, 'schema.php', `<?php $s = "CREATE TABLE {$wpdb->prefix}acme_logs ( id bigint NOT NULL, PRIMARY KEY (id) )";`);
        put(root, 'read.php', `<?php global $wpdb;
    $all = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}acme_logs" );
    $page = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}acme_logs LIMIT 20 OFFSET 0" );`);
        const c = codes(root);
        assert.equal(c.filter(x => x === 'unbounded-read').length, 1);
    });
    it('flags count() of a full result set', () => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-ps-count-'));
        put(root, 'count.php', `<?php $n = count( $this->repo->get_all() );`);
        const c = codes(root);
        assert.ok(c.includes('count-via-listall'));
    });
});
//# sourceMappingURL=perf-scale.test.js.map