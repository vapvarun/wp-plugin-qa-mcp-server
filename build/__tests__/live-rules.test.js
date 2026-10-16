import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../live/browser.js';
import { pageRules, walkRules } from '../live/rules.js';
import { checkBuild, checkRefs } from '../live/release.js';
import { danglingGuards } from '../live/config.js';
import { applyKnown } from '../live/run.js';
const base = { root: '.p', kind: 'front', dark: false, width: 1440, assertions: [] };
async function rules(html, args = {}, width = 1440) {
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.setContent(`<!doctype html><body style="margin:0;background:#fff;font:16px sans-serif">${html}</body>`);
        return (await page.evaluate(pageRules, { ...base, ...args, width })).map((f) => f.rule);
    }
    finally {
        await browser.close();
    }
}
const card = (bg, inner = '', extra = '') => `<div class="c wpcp-card" style="background:${bg};border-radius:8px;padding:16px;width:600px;min-height:80px;${extra}">${inner}</div>`;
test('clean plugin markup passes', async () => {
    assert.deepEqual(await rules(`<div class="p">${card('#fff', '<p style="color:#222">Hello there</p>')}</div>`), []);
});
test('low-contrast text fails', async () => {
    assert.ok((await rules(`<div class="p"><p style="color:#bbb">Faint label</p></div>`)).includes('contrast'));
});
test('light panel left on a dark scheme fails', async () => {
    const html = `<div class="p" style="background:#111">${card('#f8fafc', '<p style="color:#111">Card</p>')}</div>`;
    assert.ok((await rules(html, { dark: true })).includes('dark-surface'));
    assert.ok(!(await rules(`<div class="p" style="background:#111">${card('#1e1e1e', '<p style="color:#eee">Card</p>')}</div>`, { dark: true })).includes('dark-surface'));
});
test('nested card with no edge fails, with a border passes', async () => {
    const merged = card('#ffffff', card('#ffffff', '<p style="color:#111">Inner</p>', 'width:500px'));
    assert.ok((await rules(`<div class="p">${merged}</div>`)).includes('nested-card'));
    const edged = card('#ffffff', card('#f3f4f6', '<p style="color:#111">Inner</p>', 'width:500px;border:1px solid #9ca3af'));
    assert.ok(!(await rules(`<div class="p">${edged}</div>`)).includes('nested-card'));
});
test('a subtle card border or a shadow is a visible edge; form controls are not cards', async () => {
    const bordered = card('#ffffff', card('#ffffff', '<p style="color:#111">Inner</p>', 'width:500px;border:1px solid #e5e7eb'));
    assert.ok(!(await rules(`<div class="p">${bordered}</div>`)).includes('nested-card'));
    const shadowed = card('#ffffff', card('#ffffff', '<p style="color:#111">Inner</p>', 'width:500px;box-shadow:0 1px 3px rgba(0,0,0,.2)'));
    assert.ok(!(await rules(`<div class="p">${shadowed}</div>`)).includes('nested-card'));
    const field = card('#ffffff', '<textarea style="width:400px;height:80px;border-radius:6px;background:#fff;border:0"></textarea>');
    assert.ok(!(await rules(`<div class="p">${field}</div>`)).includes('nested-card'));
});
test('oklch button surfaces are measured, not skipped', async () => {
    const ok = `<div class="p"><button style="background:oklch(0.52 0.12 247);color:#fff;border:0;padding:8px"><span>Add New Field</span></button></div>`;
    assert.ok(!(await rules(ok)).includes('contrast'));
    const bad = `<div class="p" style="background:#111"><a style="display:inline-block;background:oklch(0.72 0.17 25);color:#fff;padding:8px">Book Now</a></div>`;
    assert.ok((await rules(bad, { dark: true })).includes('contrast'));
});
test('slate panels on a neutral dark theme are off-palette', async () => {
    const html = (bg) => `<style>body{background:#0a0a0a!important}</style><div class="p">${card(bg, '<p style="color:#eee">Card</p>')}</div>`;
    assert.ok((await rules(html('#1e293b'), { dark: true })).includes('off-palette'));
    assert.ok(!(await rules(html('#161616'), { dark: true })).includes('off-palette'));
});
test('form rows inside a card are not repeated items', async () => {
    const row = `<div class="r" style="width:500px;height:70px"><label>Name</label><input type="text"></div>`;
    assert.ok(!(await rules(`<div class="p">${card('#fff', `<div class="body">${row}${row}</div>`)}</div>`)).includes('merged-items'));
});
test('known failures excuse a row only when every finding in it is filed', () => {
    const known = [{ guard: 'presentation:x', match: '2.78:1', card: '9' }, { guard: 'presentation:x', match: 'gone', card: '8' }];
    const rows = [
        { guard: 'presentation:x', status: 'fail', detail: '[t dark 1440] contrast: a 2.78:1 "Book"' },
        { guard: 'presentation:x', status: 'fail', detail: '[t dark 390] contrast: a 2.78:1 "Book" | off-palette: div slate' },
    ];
    const r = applyKnown(rows, known);
    assert.deepEqual(rows.map((x) => x.status), ['skip', 'fail']);
    assert.deepEqual(r.known, ['presentation:x -> card 9']);
    assert.deepEqual(r.stale, ['presentation:x "gone" (card 8)']);
});
test('repeated items in a card with no edge merge; a border separates them', async () => {
    const item = (extra) => `<div class="m" style="width:500px;height:70px;${extra}"><p style="color:#111">Meeting</p></div>`;
    const wrap = (extra) => `<div class="p">${card('#fff', `<div class="list">${item(extra)}${item(extra)}</div>`)}</div>`;
    assert.ok((await rules(wrap(''))).includes('merged-items'));
    assert.ok(!(await rules(wrap('border:1px solid #e5e7eb;border-radius:8px'))).includes('merged-items'));
});
test('theme bullets on a classed plugin list fail', async () => {
    assert.ok((await rules(`<div class="p"><ul class="social"><li style="color:#111">x</li></ul></div>`)).includes('list-markers'));
    assert.ok(!(await rules(`<div class="p"><ul class="social" style="list-style:none"><li style="color:#111">x</li></ul></div>`)).includes('list-markers'));
});
test('sidebar is reported even when the plugin root never rendered', async () => {
    const html = `<aside id="secondary" style="width:300px;height:200px">Widgets</aside>`;
    assert.ok((await rules(html, { sidebar: '#secondary', fullWidth: true })).includes('sidebar'));
});
test('theme sidebar on a full-width plugin page fails', async () => {
    const html = `<div class="p"><p style="color:#111">Booked</p></div><aside id="secondary" style="width:300px;height:200px">Widgets</aside>`;
    assert.ok((await rules(html, { sidebar: '#secondary', fullWidth: true })).includes('sidebar'));
});
test('admin page with only a screen-reader h1 fails', async () => {
    const html = `<div id="wpbody"><h1 style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Recurring</h1><div class="p"><p style="color:#111">x</p></div></div>`;
    assert.ok((await rules(html, { kind: 'admin' })).includes('admin-header'));
});
test('box, within and gap assertions', async () => {
    const html = `<div class="p"><div class="modal" style="width:420px;height:50px"></div><div class="col" style="width:800px"><div class="act" style="margin-left:900px;width:100px;height:20px"></div></div><div class="a" style="height:10px"></div><div class="b" style="margin-top:32px;height:10px"></div></div>`;
    const got = await rules(html, {
        assertions: [
            { type: 'box', selector: '.modal', min_width: 700 },
            { type: 'within', selector: '.act', container: '.col' },
            { type: 'gap', a: '.a', b: '.b', max: 16 },
        ],
    });
    for (const r of ['box', 'within', 'gap'])
        assert.ok(got.includes(r), r);
});
test('horizontal overflow at 390 fails', async () => {
    assert.ok((await rules(`<div class="p"><div style="width:600px;height:10px"></div></div>`, {}, 390)).includes('overflow'));
});
test('walk: empty platform list and PHP warnings are caught', async () => {
    const browser = await launch();
    try {
        const page = await browser.newPage();
        await page.setContent(`<div class="m"><h3>Choose Your Platform</h3><p>Connect one:</p><div class="wpcp-onboarding__platforms"></div></div>`);
        assert.deepEqual((await page.evaluate(walkRules, '.m')).map((f) => f.rule), ['empty-container']);
        await page.setContent(`<div class="m">Warning: Undefined variable $x in /a.php on line 3<div class="x__list"><span>ok</span></div></div>`);
        assert.deepEqual((await page.evaluate(walkRules, '.m')).map((f) => f.rule), ['php-error']);
    }
    finally {
        await browser.close();
    }
});
test('release: swallowed make-pot and unguarded excluded refs fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wppqa-rel-'));
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'admin'));
    writeFileSync(join(dir, 'bin/build-release.sh'), 'wp i18n make-pot . languages/x.pot \\\n  --quiet 2>/dev/null || echo "warn"\n');
    assert.equal(checkBuild(dir, {}).status, 'fail');
    writeFileSync(join(dir, 'bin/build-release.sh'), 'if ! wp i18n make-pot . languages/x.pot --quiet; then exit 1; fi\n');
    assert.equal(checkBuild(dir, {}).status, 'pass');
    writeFileSync(join(dir, 'admin/wizard.php'), "<?php\n$u = plugins_url( 'tools/setup-test-data.php', __FILE__ );\n");
    assert.equal(checkRefs(dir, { excluded: ['tools/'] }).status, 'fail');
    writeFileSync(join(dir, 'admin/wizard.php'), "<?php\nif ( file_exists( $d . 'tools/setup-test-data.php' ) ) {\n  $u = 'tools/setup-test-data.php';\n}\n");
    assert.equal(checkRefs(dir, { excluded: ['tools/'] }).status, 'pass');
    // A guarded dev-only handler is fine; an unguarded link to it is a dead control on real installs.
    writeFileSync(join(dir, 'admin/handler.php'), "<?php\nif ( isset( $_GET['seed_demo'] ) ) {\n  $f = $d . 'tools/seed.php';\n  if ( file_exists( $f ) ) { require $f; }\n}\n");
    writeFileSync(join(dir, 'admin/wizard.php'), "<?php\n$u = admin_url( '?seed_demo=1' );\n");
    const r = checkRefs(dir, { excluded: ['tools/'] });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /seed_demo/);
    writeFileSync(join(dir, 'admin/wizard.php'), "<?php\nif ( file_exists( $d . 'tools/seed.php' ) ) {\n  $u = admin_url( '?seed_demo=1' );\n}\n");
    assert.equal(checkRefs(dir, { excluded: ['tools/'] }).status, 'pass');
});
test('ledger: a guard id that no config check defines is dangling', () => {
    const cfg = { checks: { states: [{ id: 'refund-free' }] } };
    const d = danglingGuards(cfg, [
        { card: '1', title: 'a', guard: 'states:refund-free' },
        { card: '2', title: 'b', guard: 'states:gone' },
    ]);
    assert.deepEqual(d.map((e) => e.card), ['2']);
});
//# sourceMappingURL=live-rules.test.js.map