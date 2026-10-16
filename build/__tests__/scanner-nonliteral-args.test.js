import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanAdminPages, scanShortcodes, scanCronJobs, scanOptionsWiring } from '../scanner.js';
/**
 * df1960a taught scanRestRoutes to resolve class constants. The SAME blind spot
 * was still silently zeroing three other scanners, which nobody had measured.
 * Measured on BuddyNext when this was written:
 *
 *   - PRO adminPages: 0 reported against 19 real add_submenu_page() calls,
 *     because argument 5 is self::PAGE_SLUG. FREE's top-level menu vanished the
 *     same way on $bn_label + self::TOP_SLUG.
 *   - PRO shortcodes: 3 reported against 4 — buddynext_members_only registers as
 *     self::SHORTCODE.
 *   - cron counted WP-Cron only, while the plugin's documented async engine is
 *     Action Scheduler: 45 FREE + 28 PRO jobs reported as zero.
 *
 * Reporting zero for a surface that exists answers the manifest-first question
 * in the one direction that makes a team rebuild what it already ships, so each
 * case is pinned here.
 */
function one(php) {
    const file = '/plugin/includes/Fixture.php';
    return [[file], new Map([[file, php]]), '/plugin'];
}
describe('admin pages with non-literal arguments', () => {
    it('resolves a class-constant slug behind a translated title', () => {
        const [files, contents, root] = one(`<?php
class AnalyticsAdmin {
	const PAGE_SLUG = 'buddynext-analytics';

	public function menu() {
		add_submenu_page(
			'buddynext',
			esc_html__( 'Analytics', 'buddynext-pro' ),
			'',
			'manage_options',
			self::PAGE_SLUG,
			array( $this, 'render_page' )
		);
	}
}
`);
        const pages = scanAdminPages(files, contents, root);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].slug, 'buddynext-analytics');
        assert.equal(pages[0].title, 'Analytics');
        assert.equal(pages[0].capability, 'manage_options');
        assert.equal(pages[0].parentSlug, 'buddynext');
        assert.equal(pages[0].callback, 'render_page');
    });
    it('resolves a top-level menu whose title is a variable and slug a constant', () => {
        const [files, contents, root] = one(`<?php
class AdminHub {
	const TOP_SLUG = 'buddynext';

	public function menu() {
		$bn_label = __( 'BuddyNext', 'buddynext' );
		add_menu_page(
			$bn_label,
			$bn_label,
			'manage_options',
			self::TOP_SLUG,
			array( $this, 'render_section' ),
			'dashicons-networking',
			30
		);
	}
}
`);
        const pages = scanAdminPages(files, contents, root);
        assert.equal(pages.length, 1);
        // The slug resolves even though the title cannot. An unresolvable title is
        // reported empty rather than dropping the whole page.
        assert.equal(pages[0].slug, 'buddynext');
        assert.equal(pages[0].title, '');
        assert.equal(pages[0].callback, 'render_section');
    });
    it('keeps a title containing a period intact', () => {
        const [files, contents, root] = one(`<?php
add_options_page( 'Reports. Beta', 'Reports', 'manage_options', 'x-reports', 'render' );
`);
        const pages = scanAdminPages(files, contents, root);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].title, 'Reports. Beta');
        assert.equal(pages[0].parentSlug, 'options-general.php');
    });
    it('ignores a mention inside a docblock', () => {
        const [files, contents, root] = one(`<?php
/**
 * Every screen kept its original add_submenu_page( 'a', 'b', 'c', 'd', 'e' ) call.
 */
class Documented {}
`);
        assert.equal(scanAdminPages(files, contents, root).length, 0);
    });
    it('is not shifted by a trailing comment whose prose contains a comma', () => {
        // BuddyNext Free's SetupWizard, verbatim. The comment's comma used to split
        // one argument into two, shifting the slug out of position so the page
        // vanished from the manifest.
        const [files, contents, root] = one(`<?php
class SetupWizard {
	public function add_wizard_page(): void {
		$hook = add_submenu_page(
			'buddynext',
			__( 'BuddyNext Setup', 'buddynext' ),
			'',  // No label, hides from submenu.
			'manage_options',
			'buddynext-setup',
			array( $this, 'render_page' )
		);
	}
}
`);
        const pages = scanAdminPages(files, contents, root);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].slug, 'buddynext-setup');
        assert.equal(pages[0].title, 'BuddyNext Setup');
        assert.equal(pages[0].capability, 'manage_options');
    });
    it("survives an apostrophe inside a comment in the argument list", () => {
        const [files, contents, root] = one(`<?php
add_submenu_page(
	'parent',
	'Title',
	'Menu',
	// don't show this to subscribers
	'edit_posts',
	'child-slug',
	'render_child'
);
`);
        const pages = scanAdminPages(files, contents, root);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].slug, 'child-slug');
    });
    it('still reads a plain all-literal registration', () => {
        const [files, contents, root] = one(`<?php
add_submenu_page( 'parent', 'Title', 'Menu', 'edit_posts', 'child-slug', 'render_child' );
`);
        const pages = scanAdminPages(files, contents, root);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].slug, 'child-slug');
        assert.equal(pages[0].title, 'Title');
        assert.equal(pages[0].capability, 'edit_posts');
    });
});
describe('shortcodes with non-literal tags', () => {
    it('resolves a class-constant tag next to a literal one', () => {
        const [files, contents, root] = one(`<?php
class ContentProtection {
	const SHORTCODE = 'buddynext_members_only';

	public function init() {
		add_shortcode( self::SHORTCODE, array( $this, 'render' ) );
		add_shortcode( 'plain_tag', array( $this, 'other' ) );
	}
}
`);
        const codes = scanShortcodes(files, contents, root);
        assert.deepEqual(codes.map((s) => s.tag).sort(), ['buddynext_members_only', 'plain_tag']);
        assert.equal(codes.find((s) => s.tag === 'buddynext_members_only')?.callback, 'render');
    });
});
describe('options wiring with non-literal names', () => {
    it('resolves a class-constant option name and keeps read/write sides apart', () => {
        const [files, contents, root] = one(`<?php
class MembershipAdmin {
	const PAGE_OPTION = 'buddynext_pro_page_membership';

	public function step() {
		if ( ! get_option( self::PAGE_OPTION, 0 ) ) {
			return;
		}
		update_option( self::PAGE_OPTION, 12 );
		update_option( 'plain_option', 'x' );
	}
}
`);
        const opts = scanOptionsWiring(files, contents, root);
        const byName = Object.fromEntries(opts.map((o) => [o.optionName, o]));
        assert.deepEqual(Object.keys(byName).sort(), ['buddynext_pro_page_membership', 'plain_option']);
        assert.equal(byName['buddynext_pro_page_membership'].readAt.length, 1);
        assert.equal(byName['buddynext_pro_page_membership'].writtenAt.length, 1);
        // The read is the subject of an `if ( ! ... )`, so it is an enforcement site.
        assert.equal(byName['buddynext_pro_page_membership'].enforcedAt.length, 1);
    });
    it('skips an interpolated name rather than inventing a row', () => {
        const [files, contents, root] = one(`<?php
$v = get_option( "bn_cache_{$id}" );
$w = get_option( 'bn_real_option' );
`);
        const names = scanOptionsWiring(files, contents, root).map((o) => o.optionName);
        assert.deepEqual(names, ['bn_real_option']);
    });
});
describe('cron across both schedulers', () => {
    it('records Action Scheduler jobs alongside WP-Cron', () => {
        const [files, contents, root] = one(`<?php
class CronScheduler {
	const DIGEST = 'buddynext_daily_digest';

	public function boot() {
		wp_schedule_event( time(), 'hourly', 'buddynext_hourly_sweep' );
		wp_schedule_single_event( time() + 60, 'buddynext_one_shot' );
		as_schedule_recurring_action( time(), DAY_IN_SECONDS, self::DIGEST );
		as_schedule_single_action( time(), 'buddynext_rebuild_index' );
		as_enqueue_async_action( 'buddynext_async_fanout' );
	}
}
`);
        const jobs = scanCronJobs(files, contents, root);
        const byHook = Object.fromEntries(jobs.map((c) => [c.hook, c]));
        assert.deepEqual(Object.keys(byHook).sort(), [
            'buddynext_async_fanout',
            'buddynext_daily_digest',
            'buddynext_hourly_sweep',
            'buddynext_one_shot',
            'buddynext_rebuild_index',
        ]);
        assert.equal(byHook['buddynext_hourly_sweep'].engine, 'wp-cron');
        assert.equal(byHook['buddynext_hourly_sweep'].recurrence, 'hourly');
        assert.equal(byHook['buddynext_daily_digest'].engine, 'action-scheduler');
        assert.equal(byHook['buddynext_async_fanout'].engine, 'action-scheduler');
        assert.equal(byHook['buddynext_one_shot'].recurrence, 'single');
    });
    it('survives a timestamp argument that itself contains a comma', () => {
        const [files, contents, root] = one(`<?php
wp_schedule_event( strtotime( 'tomorrow', current_time( 'timestamp' ) ), 'daily', 'buddynext_nightly' );
`);
        const jobs = scanCronJobs(files, contents, root);
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].hook, 'buddynext_nightly');
        assert.equal(jobs[0].recurrence, 'daily');
    });
});
//# sourceMappingURL=scanner-nonliteral-args.test.js.map