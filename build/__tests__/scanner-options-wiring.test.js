import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanOptionsWiring } from '../scanner.js';
// A fixture mimicking the real BN pattern: an option written in admin, read+enforced
// in a REST guard, and read (not enforced) in a template.
const ADMIN = `<?php update_option( 'buddynext_allow_shares', '1' );`;
const REST = `<?php
function share() {
  if ( ! (bool) get_option( 'buddynext_allow_shares', true ) ) {
    return new WP_Error( 'shares_disabled', 'x', array( 'status' => 403 ) );
  }
}`;
const TPL = `<?php $can = get_option( 'buddynext_allow_shares', true ); echo $can;`;
function fixture() {
    const contents = new Map([
        ['/p/admin.php', ADMIN],
        ['/p/rest.php', REST],
        ['/p/tpl.php', TPL],
    ]);
    return { files: [...contents.keys()], contents };
}
describe('scanOptionsWiring', () => {
    it('records write, read, and enforcement sites for one option', () => {
        const { files, contents } = fixture();
        const rows = scanOptionsWiring(files, contents, '/p');
        const row = rows.find((r) => r.optionName === 'buddynext_allow_shares');
        assert.ok(row, 'option should be found');
        assert.equal(row.writtenAt.length, 1, 'one write site (admin update_option)');
        assert.equal(row.readAt.length, 2, 'two read sites (rest + tpl)');
        assert.equal(row.enforcedAt.length, 1, 'one enforcement site (the REST guard)');
        assert.equal(row.enforcedAt[0].file, 'rest.php');
        assert.equal(row.defaultValue, 'true');
    });
    it('flags a saved-but-never-enforced option (dead toggle smell) with empty enforcedAt', () => {
        const contents = new Map([
            ['/p/a.php', `<?php update_option( 'buddynext_dead', '1' ); $x = get_option( 'buddynext_dead' );`],
        ]);
        const rows = scanOptionsWiring([...contents.keys()], contents, '/p');
        const row = rows.find((r) => r.optionName === 'buddynext_dead');
        assert.ok(row);
        assert.equal(row.enforcedAt.length, 0, 'no enforcement → dead toggle smell');
    });
});
//# sourceMappingURL=scanner-options-wiring.test.js.map