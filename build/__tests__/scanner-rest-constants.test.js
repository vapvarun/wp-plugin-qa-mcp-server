import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanRestRoutes } from '../scanner.js';
/**
 * The manifest answers "does this route already exist?" — the one question the
 * manifest-first rule depends on. It used to answer WRONG in the direction that
 * reads as "this does not exist yet", which is the failure mode that makes us
 * rebuild something we already ship. Two causes, both pinned here:
 *
 *   1. The route path had to be a quoted literal, so every call passing a class
 *      constant (self::BASE) vanished ENTIRELY — not flagged, not zero, absent.
 *   2. Only the first `methods` key in a merged args array was recorded, so a
 *      GET merged into a POST registration was invisible.
 *
 * Measured against BuddyNext Pro when this was written: 68 real
 * register_rest_route() calls, 57 seen.
 */
const CONST_ROUTES = `<?php
class ModRulesController {
	private const NS   = 'demo-pro/v1';
	private const BASE = '/mod-rules';

	public function register(): void {
		register_rest_route(
			self::NS,
			self::BASE,
			array(
				array(
					'methods'  => WP_REST_Server::READABLE,
					'callback' => array( $this, 'index' ),
					'permission_callback' => '__return_true',
				),
				array(
					'methods'  => WP_REST_Server::CREATABLE,
					'callback' => array( $this, 'create' ),
					'permission_callback' => array( $this, 'can_edit' ),
				),
			)
		);

		register_rest_route(
			self::NS,
			self::BASE . '/(?P<id>[\\d]+)',
			array(
				'methods'  => 'DELETE',
				'callback' => array( $this, 'destroy' ),
				'permission_callback' => array( $this, 'can_edit' ),
			)
		);
	}
}`;
const LITERAL_ROUTE = `<?php
register_rest_route(
	'demo/v1',
	'/ping',
	array(
		'methods'  => 'GET',
		'callback' => 'demo_ping',
		'permission_callback' => '__return_true',
	)
);`;
function fixture() {
    const contents = new Map([
        ['/p/includes/ModRulesController.php', CONST_ROUTES],
        ['/p/includes/ping.php', LITERAL_ROUTE],
    ]);
    return { files: [...contents.keys()], contents };
}
describe('scanRestRoutes: constant-registered routes', () => {
    const { files, contents } = fixture();
    const routes = scanRestRoutes(files, contents, '/p');
    it('resolves a class-constant namespace and route path', () => {
        const r = routes.find((x) => x.route === '/mod-rules');
        assert.ok(r, 'a route registered as self::NS + self::BASE must not vanish');
        assert.equal(r.namespace, 'demo-pro/v1');
    });
    it('resolves a constant concatenated with a literal', () => {
        const r = routes.find((x) => x.route === '/mod-rules/(?P<id>[\\d]+)');
        assert.ok(r, 'self::BASE . \'/(?P<id>…)\' must resolve to the full path');
    });
    it('records EVERY method in a merged args array, not just the first', () => {
        const r = routes.find((x) => x.route === '/mod-rules');
        assert.ok(r, 'route missing');
        assert.ok(r.methods.includes('GET'), 'the merged GET was dropped');
        assert.ok(r.methods.includes('POST'), 'the merged POST was dropped');
    });
    it('still reads a plain literal registration', () => {
        const r = routes.find((x) => x.route === '/ping');
        assert.ok(r, 'the literal path must keep working');
        assert.equal(r.namespace, 'demo/v1');
    });
});
//# sourceMappingURL=scanner-rest-constants.test.js.map