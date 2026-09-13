import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanRestRoutes } from '../scanner.js';
/**
 * A comment that merely NAMES register_rest_route() must not eat the next real
 * registration.
 *
 * The scanner already skipped comment matches, but with `continue` alone - which
 * does not rewind the global regex. The route group is lazy yet still runs to
 * the next `, array(`, and for a prose mention that terminator sits INSIDE the
 * following genuine registration. So the phantom match consumed a real route and
 * skipping it discarded the route with it.
 *
 * Measured on BuddyNext when this was written: three routes lost. /feed/home,
 * where a docblock explaining validate_callback swallowed the registration 36
 * lines below it, and two in ModerationController (31 real registrations, 29
 * seen), where comments about how WordPress merges duplicate registrations ate
 * the registrations they were describing.
 *
 * The direction matters: a route that EXISTS but is missing from the manifest
 * reads as "not built yet" under the manifest-first rule, which is how a feature
 * gets rebuilt.
 */
// Mirrors BuddyNext's Feed/FeedController.php: a docblock naming
// register_rest_route(), then the registration it describes.
const DOCBLOCK_THEN_ROUTE = `<?php
class FeedController {

	/**
	 * Pagination args shared by the feed routes.
	 *
	 * validate_callback is set EXPLICITLY and must stay that way. Core gates on
	 * \`! empty( $arg['validate_callback'] )\`, and register_rest_route() defaults it
	 * only for schema-derived args, never for a hand-written block like this.
	 */
	private function feed_pagination_args(): array {
		return array( 'page' => array( 'type' => 'integer' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			'demo/v1',
			'/feed/home',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'home_feed' ),
				'permission_callback' => array( $this, 'require_auth' ),
				'args'                => $this->feed_pagination_args() + array(
					'filter' => array( 'type' => 'string' ),
				),
			)
		);

		register_rest_route(
			'demo/v1',
			'/feed/counts',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'counts' ),
				'permission_callback' => array( $this, 'require_auth' ),
			)
		);
	}
}`;
// Mirrors Moderation/ModerationController.php: a line comment about merged
// registrations sitting directly above the registrations it describes.
const LINE_COMMENT_THEN_ROUTES = `<?php
class ModerationController {
	public function register_routes(): void {
		// WordPress merges multiple register_rest_route() calls on the same path,
		// so the GET methods below are registered separately on purpose.
		register_rest_route(
			'demo/v1',
			'/reports',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'index' ),
				'permission_callback' => array( $this, 'can_moderate' ),
			)
		);

		register_rest_route(
			'demo/v1',
			'/reports/(?P<id>[\\d]+)',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( $this, 'destroy' ),
				'permission_callback' => array( $this, 'can_moderate' ),
			)
		);
	}
}`;
function fixture() {
    const contents = new Map([
        ['/p/includes/FeedController.php', DOCBLOCK_THEN_ROUTE],
        ['/p/includes/ModerationController.php', LINE_COMMENT_THEN_ROUTES],
    ]);
    return { files: [...contents.keys()], contents };
}
describe('scanRestRoutes: a comment mention must not swallow the next route', () => {
    const { files, contents } = fixture();
    const routes = scanRestRoutes(files, contents, '/p');
    it('records the route registered below a docblock that names register_rest_route()', () => {
        const r = routes.find((x) => x.route === '/feed/home');
        assert.ok(r, '/feed/home must survive the docblock above it — this is the exact route BuddyNext lost');
        assert.equal(r.namespace, 'demo/v1');
    });
    it('still records the route after it', () => {
        assert.ok(routes.find((x) => x.route === '/feed/counts'), 'rewinding must not cost the following registration');
    });
    it('records routes registered below a // comment that names register_rest_route()', () => {
        assert.ok(routes.find((x) => x.route === '/reports'), '/reports must survive the line comment above it');
        assert.ok(routes.find((x) => x.route === '/reports/(?P<id>[\\d]+)'), 'the second registration in the consumed span must also survive');
    });
    it('records no phantom route for the comment itself', () => {
        const phantoms = routes.filter((x) => !x.route || !String(x.route).startsWith('/') || String(x.route).includes(' '));
        assert.equal(phantoms.length, 0, `a comment must not become a route: ${JSON.stringify(phantoms.map((p) => p.route))}`);
    });
    it('finds exactly the four real registrations across both files', () => {
        assert.equal(routes.length, 4, `expected 4 routes, got ${JSON.stringify(routes.map((r) => r.route))}`);
    });
});
//# sourceMappingURL=scanner-comment-mention.test.js.map