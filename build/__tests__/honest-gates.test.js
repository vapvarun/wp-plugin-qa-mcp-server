/**
 * Known-bad fixtures for the gates that used to report PASS without checking.
 * Each test proves the gate now refuses the bad input and still accepts the good one.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WpPluginQaServer } from '../server.js';
import { tools } from '../tools.js';
import { checkApi } from '../api-checker.js';
import { checkPluginDevRules } from '../plugin-dev-rules-checker.js';
import { formatEngine } from '../cert-runner.js';
import { classifyVerdict, deriveExpected, matrixVerdict, probeRoleMatrix, substituteRouteParams, } from '../role-matrix-prober.js';
import { crawlLinks, watchPage } from '../live/checks.js';
import { checkBuild, checkRefs, distignoreRule, stripComments } from '../live/release.js';
import { formatLedger, judge } from '../live/run.js';
const temps = [];
const closers = [];
after(() => {
    for (const d of temps)
        rmSync(d, { recursive: true, force: true });
    for (const c of closers)
        c();
});
function plugin(files) {
    const root = mkdtempSync(join(tmpdir(), 'wppqa-honest-'));
    temps.push(root);
    for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), content);
    }
    return root;
}
/** A stand-in WordPress: the handler decides every response. */
async function site(handler) {
    const srv = createServer(handler);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => { srv.closeAllConnections(); srv.close(); });
    return `http://127.0.0.1:${srv.address().port}`;
}
const manifest = (rest, ajax = []) => ({ features: { restRoutes: rest, ajaxHandlers: ajax } });
const route = (r, methods, permissionCallback) => ({ namespace: 'acme/v1', route: r, methods, permissionCallback, file: 'api.php', line: 1 });
const GUEST = { id: 'guest', label: 'Guest', authType: 'none', expectedCapability: '' };
const ADMIN = {
    id: 'admin', label: 'Admin', authType: 'application-password',
    credentials: { username: 'admin', appPassword: 'pw' }, expectedCapability: 'manage_options',
};
const server = new WpPluginQaServer();
// ── 2. probe_roles ──────────────────────────────────────────────────────────
test('probe_roles: a role without credentials is NOT RUN and the matrix is INCOMPLETE, not a pass', async () => {
    const url = await site((_q, res) => res.writeHead(200).end('{}'));
    const report = await probeRoleMatrix({
        pluginPath: '', siteUrl: url,
        scanManifestCache: manifest([route('/open', ['GET'], '__return_true')]),
    }); // default roles: subscriber/editor/admin ship with empty credentials
    assert.equal(report.endpoints[0].observedByRole.guest.verdict, 'match');
    assert.equal(report.endpoints[0].observedByRole.admin.verdict, 'not-run');
    assert.deepEqual(report.summary.rolesNotRun, ['subscriber', 'editor', 'admin']);
    assert.equal(report.summary.verdict, 'INCOMPLETE');
});
test('probe_roles: unresolved and custom callbacks are "expectation unknown", never a match', () => {
    for (const pc of ['<unresolved>', 'can_edit_thing', 'nopriv']) {
        assert.equal(deriveExpected(pc, ADMIN), 'unknown', pc);
        assert.equal(deriveExpected(pc, GUEST), 'unknown', pc);
    }
    // AJAX: only "a guest cannot reach a non-nopriv action" is derivable.
    assert.equal(deriveExpected('logged-in', ADMIN), 'unknown');
    assert.equal(deriveExpected('logged-in', GUEST), 'not-logged-in');
    assert.equal(classifyVerdict(200, 'unknown'), 'unknown');
    assert.equal(classifyVerdict(403, 'unknown'), 'unknown');
    assert.equal(classifyVerdict(500, 'unknown'), 'mismatch', 'a 5xx fails whatever the rule');
    assert.equal(classifyVerdict(400, 'not-logged-in', 'ajax'), 'match', 'admin-ajax answers a guest with 400');
    assert.equal(matrixVerdict({ match: 5, mismatch: 0, unknown: 1, 'not-run': 0, skipped: 0 }, []), 'INCOMPLETE');
    assert.equal(matrixVerdict({ match: 5, mismatch: 1, unknown: 0, 'not-run': 0, skipped: 0 }, []), 'FAIL');
    assert.equal(matrixVerdict({ match: 0, mismatch: 0, unknown: 0, 'not-run': 0, skipped: 0 }, []), 'INCOMPLETE', 'zero probes is not a pass');
    assert.equal(matrixVerdict({ match: 5, mismatch: 0, unknown: 0, 'not-run': 0, skipped: 0 }, []), 'PASS');
});
test('probe_roles: regex params get a sample value; an unfillable route is skipped; a 404 is never a match', async () => {
    assert.equal(substituteRouteParams('/acme/v1/items/(?P<id>\\d+)'), '/acme/v1/items/1');
    assert.equal(substituteRouteParams('/acme/v1/items/(?P<slug>[a-z-]+)/meta'), '/acme/v1/items/sample/meta');
    assert.equal(substituteRouteParams('/acme/v1/k/(?P<key>[A-F0-9]{32})'), null);
    assert.equal(substituteRouteParams('/acme/v1/plain'), '/acme/v1/plain');
    const seen = [];
    const url = await site((req, res) => {
        seen.push(req.url ?? '');
        res.writeHead(404).end('{"code":"acme_not_found"}');
    });
    const report = await probeRoleMatrix({
        pluginPath: '', siteUrl: url, roles: [ADMIN],
        scanManifestCache: manifest([
            route('/items/(?P<id>\\d+)', ['GET'], 'check_admin_permission'),
            route('/k/(?P<key>[A-F0-9]{32})', ['GET'], 'check_admin_permission'),
        ]),
    });
    assert.deepEqual(seen, ['/wp-json/acme/v1/items/1'], 'the literal regex is never requested');
    assert.equal(report.endpoints[0].observedByRole.admin.verdict, 'unknown', '404 for a sample id proves nothing');
    assert.equal(report.endpoints[1].observedByRole.admin.verdict, 'skipped');
    assert.equal(report.summary.matched, 0);
    assert.equal(report.summary.verdict, 'INCOMPLETE');
});
// ── 1. isError on FAIL ──────────────────────────────────────────────────────
test('probe_roles tool: a mismatch sets isError and keeps the report; a clean full matrix does not', async () => {
    // Bad: an admin-only route that answers a guest with 200.
    const leaky = await site((_q, res) => res.writeHead(200).end('{}'));
    const root = plugin({
        'acme.php': `<?php
/** Plugin Name: Acme */
add_action( 'rest_api_init', function () {
	register_rest_route( 'acme/v1', '/settings', array(
		'methods'             => 'GET',
		'callback'            => 'acme_get_settings',
		'permission_callback' => 'check_admin_permission',
	) );
} );`,
    });
    const bad = await server.handleProbeRoles(root, leaky, [GUEST, ADMIN]);
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /^FAIL wppqa_probe_roles/);
    assert.match(bad.content[0].text, /"endpoints"/, 'report body is kept');
    // Good: the same route refuses the guest and serves the admin.
    const guarded = await site((req, res) => res.writeHead(req.headers.authorization ? 200 : 401).end('{}'));
    const good = await server.handleProbeRoles(root, guarded, [GUEST, ADMIN]);
    assert.equal(good.isError, false);
    assert.match(good.content[0].text, /^PASS wppqa_probe_roles/);
});
test('run_checks tool: a failing ledger sets isError and keeps the report', async () => {
    const root = plugin({ 'docs/qa/qa-config.json': JSON.stringify({ slug: 'acme', checks: { release: {} } }) });
    const r = await server.handleRunChecks({ plugin_path: root }); // languages/acme.pot is missing
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /^FAIL wppqa_run_checks/);
    assert.match(r.content[0].text, /release:pot/);
});
test('audit_plugin tool: an error-level finding sets isError in text and json formats', async () => {
    const header = `<?php\n/** Plugin Name: Acme */\n`;
    const bare = plugin({ 'acme.php': `${header}function acme_save() {\n\tcheck_admin_referer( 'acme_save' );\n\tupdate_option( 'acme', 1 );\n}\n` });
    const bad = await server.handleAuditPlugin(bare);
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /^FAIL FULL PLUGIN AUDIT/);
    const text = (await server.handleAuditPlugin(bare, undefined, 'json')).content[0].text;
    assert.equal(JSON.parse(text).verdict, 'FAIL');
});
// ── 3. check_api ────────────────────────────────────────────────────────────
const loggedIn = (res) => res.writeHead(302, { 'Set-Cookie': 'wordpress_logged_in_abc=admin%7C1; path=/; HttpOnly', Location: '/' }).end();
test('check_api: a failed autologin is an error and no endpoint is counted as passed', async () => {
    const url = await site((_q, res) => res.writeHead(200).end('<html>login page</html>'));
    const r = await checkApi(manifest([route('/a', ['GET'], 'x'), route('/b', ['GET'], 'x')]), url);
    assert.equal(r.issues[0].code, 'autologin-failed');
    assert.equal(r.issues[0].type, 'error');
    assert.deepEqual([r.passed, r.failed, r.skipped], [0, 1, 2]);
});
test('check_api: an unauthenticated write that succeeds fails; a 5xx fails; passes are counted, skips are not passes', async () => {
    const url = await site((req, res) => {
        if (req.url?.includes('autologin'))
            return loggedIn(res);
        if (req.url === '/wp-admin/')
            return res.writeHead(200).end('wpApiSettings = {"root":"x","nonce":"n1"}');
        if (req.url?.endsWith('/open-write'))
            return res.writeHead(204).end(); // 2xx without auth
        if (req.url?.endsWith('/boom'))
            return res.writeHead(500).end('{}');
        if (req.url?.endsWith('/guarded-write'))
            return res.writeHead(req.headers.cookie ? 200 : 401).end('{}');
        res.writeHead(200).end('{}');
    });
    const r = await checkApi(manifest([
        route('/open-write', ['POST'], 'x'),
        route('/boom', ['GET'], 'x'),
        route('/guarded-write', ['POST'], 'x'),
        route('/read', ['GET'], 'x'),
        route('/k/(?P<key>[A-F0-9]{32})', ['GET'], 'x'),
    ]), url);
    const codes = r.issues.map((i) => i.code);
    assert.ok(codes.includes('rest-unauth-write'), '204 without auth is a successful write');
    assert.ok(codes.includes('rest-server-error'));
    assert.ok(codes.includes('rest-route-skipped'));
    assert.deepEqual([r.passed, r.failed, r.skipped], [2, 2, 1]);
});
test('check_api: an unauthenticated request that cannot be sent is recorded, not swallowed', async () => {
    const url = await site((req, res) => {
        if (req.url?.includes('autologin'))
            return loggedIn(res);
        if (req.method === 'POST')
            return void req.socket.destroy();
        res.writeHead(200).end('{}');
    });
    const r = await checkApi(manifest([route('/w', ['POST'], 'x')]), url);
    assert.ok(r.issues.some((i) => i.code === 'rest-unauth-request-failed' && i.type === 'error'));
    assert.deepEqual([r.passed, r.failed], [0, 1]);
});
// ── 4. cert-engine ──────────────────────────────────────────────────────────
const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'cert-engine.php');
/** Run the engine under plain PHP with the handful of WP functions it calls stubbed. */
function engine(manifestJson, oracles) {
    const dir = mkdtempSync(join(tmpdir(), 'wppqa-cert-'));
    temps.push(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestJson));
    if (oracles)
        writeFileSync(join(dir, 'oracles.json'), JSON.stringify(oracles));
    writeFileSync(join(dir, 'run.php'), `<?php
define( 'ABSPATH', __DIR__ );
$GLOBALS['opts'] = array();
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_set_current_user( $id ) {}
function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; }
function delete_option( $k ) { unset( $GLOBALS['opts'][ $k ] ); }
class WP_REST_Request { public function __construct( $m, $r ) {} public function set_param( $k, $v ) {} }
class Fake_Response { public function get_data() { return array(); } public function get_status() { return 200; } }
function rest_do_request( $r ) { return new Fake_Response(); }
$args = array( __DIR__ . '/manifest.json'${oracles ? ", __DIR__ . '/oracles.json'" : ''} );
require ${JSON.stringify(ENGINE)};
`);
    return JSON.parse(execFileSync('php', [join(dir, 'run.php')], { encoding: 'utf8' }));
}
test('cert-engine: zero asserted rows is NO DATA, not ok; one booted route is a pass', () => {
    const empty = engine({ features: {} });
    assert.equal(empty.ok, false);
    assert.equal(empty.no_data, true);
    const text = formatEngine({ ran: true, ledger: { ...empty, rows: [] } });
    assert.match(text, /^NO DATA/);
    assert.doesNotMatch(text, /PASSED/);
    const one = engine({ features: { restRoutes: [{ namespace: 'acme/v1', route: '/x', methods: ['GET'] }] } });
    assert.equal(one.ok, true);
    assert.equal(one.no_data, false);
    assert.match(formatEngine({ ran: true, ledger: { ...one, rows: [] } }), /PASSED/);
});
test('cert-engine: knows no plugin option; a feature oracle must name its own', () => {
    assert.doesNotMatch(readFileSync(ENGINE, 'utf8'), /buddynext/i);
    const o = { id: 'polls', kind: 'feature', route: '/acme/v1/polls', off_code: 'feature_disabled' };
    const unnamed = engine({ features: {} }, { contract: [o] });
    assert.equal(unnamed.rows[0].status, 'fail');
    assert.match(unnamed.rows[0].detail, /names no option/);
    // Named through the plugin's own oracles file: the oracle runs (and fails here, the stub never returns the off code).
    const named = engine({ features: {} }, { feature_option: 'acme_features', contract: [o] });
    assert.match(named.rows[0].detail, /expect off=feature_disabled/);
});
// ── 5. release ──────────────────────────────────────────────────────────────
test('release: unanchored and slash-less .distignore entries are honoured gitignore-style', () => {
    const ref = "<?php\n$u = plugins_url( 'tools/seed.php', __FILE__ );\n";
    for (const entry of ['tools', 'tools/', '/tools', '/tools/', 'too*']) {
        const dir = plugin({ '.distignore': `# dev only\n${entry}\n`, 'tools/seed.php': '<?php', 'admin/wizard.php': ref });
        assert.equal(checkRefs(dir, {}).status, 'fail', `.distignore "${entry}"`);
    }
    // Nested match for an unanchored name, and __DIR__ . '/dir/...' is the same dependency.
    const nested = plugin({ '.distignore': 'fixtures\n', 'inc/fixtures/a.php': '<?php', 'inc/load.php': "<?php\nrequire __DIR__ . '/inc/fixtures/a.php';\n" });
    assert.equal(checkRefs(nested, {}).status, 'fail');
    // An anchored entry does not match the same name deeper down; "!" re-includes.
    assert.equal(distignoreRule('/tools').re.test('inc/tools'), false);
    assert.equal(distignoreRule('tools').re.test('inc/tools'), true);
    const reincluded = plugin({ '.distignore': 'tools\n!tools\n', 'tools/seed.php': '<?php', 'admin/wizard.php': ref });
    assert.equal(checkRefs(reincluded, {}).status, 'skip');
    // Good: the reference is guarded.
    const ok = plugin({ '.distignore': 'tools\n', 'tools/seed.php': '<?php', 'admin/wizard.php': "<?php\nif ( file_exists( $d . 'tools/seed.php' ) ) {\n\trequire $d . 'tools/seed.php';\n}\n" });
    assert.equal(checkRefs(ok, {}).status, 'pass');
});
test('release: comments are stripped properly, code after a comment on the same line is still read', () => {
    // Bad: a leading block comment used to hide the whole line.
    const hidden = plugin({ '.distignore': 'tools\n', 'tools/s.php': '<?php', 'a.php': "<?php\n/* dev */ require 'tools/s.php';\n" });
    assert.equal(checkRefs(hidden, {}).status, 'fail');
    // Bad: a commented-out file_exists() is not a guard.
    const fakeGuard = plugin({ '.distignore': 'tools\n', 'tools/s.php': '<?php', 'a.php': "<?php\n// if ( file_exists( $f ) )\nrequire 'tools/s.php';\n" });
    assert.equal(checkRefs(fakeGuard, {}).status, 'fail');
    // Good: references only inside comments of every style.
    const prose = plugin({
        '.distignore': 'tools\n', 'tools/s.php': '<?php',
        'a.php': "<?php\n// see 'tools/s.php'\n# see 'tools/s.php'\n/*\n  'tools/s.php'\n*/\n$x = 1; // 'tools/s.php'\n",
        'b.js': "/* 'tools/s.php' */\nconst a = 1; // 'tools/s.php'\n",
    });
    assert.equal(checkRefs(prose, {}).status, 'pass');
    assert.equal(stripComments("<?php $u = 'http://x/#a'; // gone", true), "<?php $u = 'http://x/#a';        ");
    assert.equal(stripComments("<p>Don't # strip</p><?php # gone\n?><b>it's</b>", true), "<p>Don't # strip</p><?php       \n?><b>it's</b>");
    assert.equal(stripComments('#[Attr]\nfn();', true), '#[Attr]\nfn();', 'outside <?php nothing is stripped');
    assert.equal(stripComments('<?php #[Attr]\n', true), '<?php #[Attr]\n', 'a PHP 8 attribute is not a comment');
    // Documented limit: a "//" inside a JS regex literal blanks the rest of that line.
    assert.equal(stripComments("x.replace(/\\/\\//, ''); y('tools/s.php');", false).includes('tools/s.php'), false);
});
test('release + ledger: a skipped release check or a release-only config is INCOMPLETE, never PASS', () => {
    const dir = plugin({ 'a.php': '<?php' });
    const build = checkBuild(dir, {});
    const refs = checkRefs(dir, {});
    assert.equal(build.status, 'skip');
    assert.equal(refs.status, 'skip');
    assert.match(build.detail, /^NOT RUN/);
    const pass = { guard: 'release:pot', status: 'pass', detail: 'ok' };
    const skipped = judge([pass, build, refs], [], true);
    assert.equal(skipped.verdict, 'INCOMPLETE');
    assert.equal(skipped.incomplete.length, 2);
    // 7. Only release checks configured: nothing opened the site.
    const releaseOnly = judge([pass], [], false);
    assert.equal(releaseOnly.verdict, 'INCOMPLETE');
    assert.match(releaseOnly.incomplete[0], /no live check ran/);
    assert.equal(judge([pass], [], true).verdict, 'PASS');
    assert.equal(judge([pass, { guard: 'x', status: 'fail', detail: 'd' }], [], true).verdict, 'FAIL');
    assert.equal(judge([pass], ['1 -> states:gone'], true).verdict, 'FAIL');
    // A known, carded failure is a deliberate skip: it does not make the run incomplete.
    assert.equal(judge([pass, { guard: 'x', status: 'skip', detail: 'known (card 1): d', known: true }], [], true).verdict, 'PASS');
    const ledger = {
        ok: false, verdict: 'INCOMPLETE', incomplete: skipped.incomplete, mode: 'fast', summary: { pass: 1, fail: 0, skip: 2 },
        rows: [pass, build, refs, { guard: 'crawl:/', status: 'pass', detail: 'ok', note: 'capped: checked 60 of 90 same-origin links' }],
        dangling: [], unguarded_failures: [], known: [], stale_known: [],
    };
    const text = formatLedger(ledger);
    assert.match(text, /^INCOMPLETE wppqa_run_checks/);
    assert.match(text, /INCOMPLETE is not a pass/);
    assert.match(text, /capped: checked 60 of 90/);
});
// ── 6. crawl ────────────────────────────────────────────────────────────────
test('crawl: console errors and failed or 4xx/5xx same-origin requests are collected; the link cap is visible', () => {
    const page = new EventEmitter();
    const seen = watchPage(page, 'https://site.local');
    const req = (url, nav = false, errorText = 'net::ERR_FAILED') => ({ url: () => url, failure: () => ({ errorText }), isNavigationRequest: () => nav });
    const res = (url, status, nav = false) => ({ url: () => url, status: () => status, request: () => req(url, nav) });
    page.emit('pageerror', new Error('boom is not defined'));
    page.emit('console', { type: () => 'error', text: () => 'Uncaught TypeError: x' });
    page.emit('console', { type: () => 'error', text: () => 'Failed to load resource: 404' }); // named by the response listener
    page.emit('console', { type: () => 'log', text: () => 'fine' });
    page.emit('response', res('https://site.local/wp-content/plugins/acme/app.js', 404));
    page.emit('response', res('https://site.local/wp-json/acme/v1/x', 500));
    page.emit('response', res('https://site.local/page', 404, true)); // the page itself: reported by the caller
    page.emit('response', res('https://cdn.example.com/x.js', 404)); // not ours
    page.emit('response', res('https://site.local/ok.css', 200));
    page.emit('requestfailed', req('https://site.local/font.woff2'));
    page.emit('requestfailed', req('https://site.local/cancelled', false, 'net::ERR_ABORTED'));
    assert.deepEqual(seen.js, ['boom is not defined', 'console: Uncaught TypeError: x']);
    assert.deepEqual(seen.requests, [
        'https://site.local/wp-content/plugins/acme/app.js -> 404',
        'https://site.local/wp-json/acme/v1/x -> 500',
        'https://site.local/font.woff2 -> net::ERR_FAILED',
    ]);
    // Good: a quiet page collects nothing.
    const quiet = watchPage(new EventEmitter(), 'https://site.local');
    assert.deepEqual([quiet.js, quiet.requests], [[], []]);
    const links = Array.from({ length: 90 }, (_, i) => `https://site.local/p/${i}`).concat('https://other.example/x', 'https://site.local/wp-login.php?action=logout');
    const walked = crawlLinks(links, 'https://site.local');
    assert.equal(walked.check.length, 60);
    assert.equal(walked.total, 90, 'the cap is reported, not hidden');
    assert.equal(crawlLinks(links.slice(0, 10), 'https://site.local').total, 10);
});
// ── 8. plugin_dev_rules ─────────────────────────────────────────────────────
const nonceFlags = (files) => checkPluginDevRules(plugin(files)).issues.filter((i) => i.code === 'nonce-no-cap').map((i) => `${i.file}:${i.line}`);
test('plugin_dev_rules is exposed again', () => {
    assert.ok(tools.some((t) => t.name === 'wppqa_check_plugin_dev_rules'));
});
test('nonce-no-cap: a current_user_can() in a neighbouring function does not clear it', () => {
    const bad = `<?php
function acme_save() {
	check_ajax_referer( 'acme_save' );
	update_option( 'acme', 1 );
}
function acme_other() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
}
`;
    assert.deepEqual(nonceFlags({ 'inc/ajax.php': bad }), ['inc/ajax.php:3']);
    const good = `<?php
function acme_save() {
	check_ajax_referer( 'acme_save' );
	if ( ! current_user_can( 'manage_options' ) ) { wp_die(); }
	update_option( 'acme', 1 );
}
add_action( 'wp_ajax_acme_x', function () {
	check_ajax_referer( 'acme_x' );
	if ( ! current_user_can( 'edit_posts' ) ) { wp_die(); }
} );
`;
    assert.deepEqual(nonceFlags({ 'inc/ajax.php': good }), []);
});
test('nonce-no-cap: only REST callbacks with their own permission_callback are exempt, not the whole file', () => {
    const controller = `<?php
class Acme_Controller {
	public function register() {
		register_rest_route( 'acme/v1', '/items', array(
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'create_item' ),
				'permission_callback' => array( $this, 'can_create' ),
			),
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'open_item' ),
				'permission_callback' => '__return_true',
			),
		) );
		add_action( 'wp_ajax_acme_legacy', array( $this, 'legacy_ajax' ) );
	}
	public function can_create() {
		return is_user_logged_in();
	}
	public function create_item( $request ) {
		wp_verify_nonce( $request['token'], 'acme_create' );
	}
	public function open_item( $request ) {
		wp_verify_nonce( $request['token'], 'acme_open' );
	}
	public function legacy_ajax() {
		check_ajax_referer( 'acme_legacy' );
		update_option( 'acme', 1 );
	}
}
`;
    // create_item is route-guarded; open_item (__return_true) and the AJAX handler in the same file are not.
    assert.deepEqual(nonceFlags({ 'includes/class-acme-controller.php': controller }), [
        'includes/class-acme-controller.php:25',
        'includes/class-acme-controller.php:28',
    ]);
});
//# sourceMappingURL=honest-gates.test.js.map