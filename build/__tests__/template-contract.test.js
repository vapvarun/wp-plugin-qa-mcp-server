import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { analyzeTemplateContracts, analyzeTemplateHygiene } from '../template-contract-checker.js';
/** Write a file under root, creating parent dirs. */
function put(root, rel, content) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
}
describe('analyzeTemplateContracts — resolver convention (v3 generalization)', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-tc-resolver-'));
        // Loader declares the two maps (route -> resolver class, route -> template).
        put(root, 'includes/class-template-loader.php', `<?php
class Template_Loader {
  private static $view_data_resolvers = array(
    'home'   => 'Acme\\\\View_Data\\\\Home_View_Data',
    'detail' => 'Acme\\\\View_Data\\\\Detail_View_Data',
  );
  private static $template_map = array(
    'home'   => 'home.php',
    'detail' => 'detail.php',
  );
  public static function render( array $data ): void {
    extract( $view_data, EXTR_SKIP );
  }
}`);
        put(root, 'includes/view-data/class-home-view-data.php', `<?php
namespace Acme\\View_Data;
class Home_View_Data {
  public static function resolve( array $data ): array {
    return array( 'title' => 'Hi', 'items' => array() );
  }
}`);
        put(root, 'includes/view-data/class-detail-view-data.php', `<?php
namespace Acme\\View_Data;
class Detail_View_Data {
  public static function resolve( array $data ): array {
    return array( 'name' => 'x' );
  }
}`);
        // Clean template — reads only supplied keys.
        put(root, 'templates/home.php', `<?php echo esc_html( $title ); foreach ( $items as $it ) { echo $it; } ?>`);
        // Drift template — reads $ghost, which the resolver never supplies.
        put(root, 'templates/detail.php', `<?php echo esc_html( $name ); echo esc_html( $ghost ); ?>`);
    });
    after(() => rmSync(root, { recursive: true, force: true }));
    it('detects the resolver convention (no longer skips)', () => {
        const a = analyzeTemplateContracts(root);
        assert.equal(a.mode, 'resolver');
        assert.equal(a.checked, 2);
        assert.equal(a.result.skipped, 0);
    });
    it('flags a template var no resolver supplies, and only that one', () => {
        const a = analyzeTemplateContracts(root);
        assert.equal(a.result.failed, 1);
        const drift = a.result.issues[0];
        assert.match(drift.title, /\$ghost/);
        assert.match(drift.file, /detail\.php/);
    });
});
describe('analyzeTemplateContracts — filter-append resolver registration (Pro pattern)', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-tc-append-'));
        // Pro registers via filter callbacks that APPEND to arrays, with templates
        // in an extension views/ dir referenced by __DIR__ (no root templates/).
        put(root, 'includes/ext/class-extension.php', `<?php
class Extension {
  public function register_template_map( array $map ): array {
    $map['widget'] = __DIR__ . '/views/widget.php';
    return $map;
  }
  public function register_view_data_resolvers( array $r ): array {
    $r['widget'] = '\\\\Acme\\\\Ext\\\\View_Data\\\\Widget_View_Data';
    return $r;
  }
}`);
        put(root, 'includes/ext/view-data/class-widget-view-data.php', `<?php
namespace Acme\\Ext\\View_Data;
class Widget_View_Data {
  public static function resolve( array $d ): array { return array( 'count' => 0 ); }
}`);
        put(root, 'includes/ext/views/widget.php', `<?php echo (int) $count; echo esc_html( $missing ); ?>`);
    });
    after(() => rmSync(root, { recursive: true, force: true }));
    it('detects append-style registration + __DIR__ template paths and flags drift', () => {
        const a = analyzeTemplateContracts(root);
        assert.equal(a.mode, 'resolver');
        assert.equal(a.checked, 1);
        assert.equal(a.result.failed, 1);
        assert.match(a.result.issues[0].title, /\$missing/);
    });
});
describe('analyzeTemplateContracts — WooCommerce-style loader (regression)', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-tc-wc-'));
        put(root, 'includes/render.php', `<?php acme_get_template( 'card.php', array( 'a' => 1 ) );`);
        put(root, 'templates/card.php', `<?php echo $a; echo $b; ?>`);
    });
    after(() => rmSync(root, { recursive: true, force: true }));
    it('still detects *_get_template() and flags the unpassed var', () => {
        const a = analyzeTemplateContracts(root);
        assert.equal(a.mode, 'wc-loader');
        assert.equal(a.result.failed, 1);
        assert.match(a.result.issues[0].title, /\$b/);
    });
});
describe('analyzeTemplateContracts — precision (no false positives)', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-tc-precision-'));
        put(root, 'includes/render.php', `<?php acme_get_template( 'p.php', array( 'real' => 1 ) );`);
        // $skip appears ONLY in: a docblock, a single-quoted printf, a nested-paren
        // foreach binding, and an arrow-fn param. None is a contract read.
        put(root, 'templates/p.php', `<?php
/** @param string $docvar comment-only, must be ignored */
echo esc_html( $real );
echo sprintf( __( '%1$s of %2$s', 'x' ), '1', '2' );
foreach ( array_filter( array_map( 'trim', explode( ',', $real ) ) ) as $loopvar ) { echo $loopvar; }
$fn = static fn( string $argvar ): bool => '' !== $argvar;
// see https://example.com/$urlvar inside a URL in a comment
?>
<div class="literal-$htmlvar-not-a-read">x</div>`);
    });
    after(() => rmSync(root, { recursive: true, force: true }));
    it('does not flag comment / printf / foreach / closure / HTML / URL vars', () => {
        const a = analyzeTemplateContracts(root);
        assert.equal(a.result.failed, 0, JSON.stringify(a.result.issues.map((i) => i.title)));
    });
});
describe('analyzeTemplateHygiene — TC1 zero-logic + TC3 components', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-tc-hygiene-'));
        // TC1: a template that fetches data ($wpdb + Model::find) — but NOT the
        // one inside a comment (must be ignored).
        put(root, 'templates/widget.php', `<?php
// $wpdb here is a comment, must be ignored
$rows = Course::find( 1 );
global $wpdb; $x = $wpdb->get_results( 'SELECT 1' );
?><div class="lrn-empty-state__icon">x</div>`);
        // TC3 canonical — must be exempt even though it contains the pattern.
        put(root, 'includes/admin/views/partials/empty-state.php', `<?php ?><div class="lrn-empty-state__icon"></div>`);
        // TC3 offender in admin view.
        put(root, 'includes/admin/views/list.php', `<?php ?><a class="button">x</a>`);
        put(root, 'audit/template-contracts.json', JSON.stringify({
            zero_logic: { template_dirs: ['templates'] },
            components: {
                rules: [
                    { name: 'empty-state-inline', scope_dirs: ['templates', 'includes/admin/views'], pattern: 'lrn-empty-state__', canonical: 'includes/admin/views/partials/empty-state.php', hint: 'use shared partial' },
                    { name: 'wp-button-admin', scope_dirs: ['includes/admin/views'], pattern: 'class="button', hint: 'use .lrn-admin-btn' },
                ],
            },
        }));
    });
    after(() => rmSync(root, { recursive: true, force: true }));
    it('TC1 flags $wpdb + Model::find in a template, ignores the commented one', () => {
        const h = analyzeTemplateHygiene(root);
        assert.equal(h.zeroLogic.findings.length, 2); // Course::find + $wpdb->get_results (the comment line is ignored)
        assert.ok(h.zeroLogic.findings.every((f) => f.file === 'templates/widget.php'));
    });
    it('TC3 flags inline empty-state + wp button, exempts the canonical partial', () => {
        const h = analyzeTemplateHygiene(root);
        const files = h.components.findings.map((f) => f.file);
        assert.ok(files.includes('templates/widget.php')); // inline empty-state
        assert.ok(files.includes('includes/admin/views/list.php')); // wp button
        assert.ok(!files.includes('includes/admin/views/partials/empty-state.php')); // canonical exempt
    });
});
describe('analyzeTemplateContracts — skip when no convention', () => {
    let root;
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'wppqa-tc-skip-'));
        put(root, 'templates/x.php', `<?php echo $whatever; ?>`); // templates exist, but no loader convention
    });
    after(() => rmSync(root, { recursive: true, force: true }));
    it('skips (cannot verify without a known loader)', () => {
        const a = analyzeTemplateContracts(root);
        assert.equal(a.mode, 'none');
        assert.equal(a.result.skipped, 1);
    });
});
//# sourceMappingURL=template-contract.test.js.map