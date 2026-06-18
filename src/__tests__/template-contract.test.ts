import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { analyzeTemplateContracts } from '../template-contract-checker.js';

/** Write a file under root, creating parent dirs. */
function put(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('analyzeTemplateContracts — resolver convention (v3 generalization)', () => {
  let root: string;
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

describe('analyzeTemplateContracts — WooCommerce-style loader (regression)', () => {
  let root: string;
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
  let root: string;
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

describe('analyzeTemplateContracts — skip when no convention', () => {
  let root: string;
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
