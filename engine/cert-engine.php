<?php
/**
 * Generic functional-certification engine (the "jury").
 *
 * Plugin-agnostic. Run via `wp eval-file engine/cert-engine.php <manifest.json> [oracles.json]`
 * against any WordPress site. It reads the MCP scanner's manifest (PluginManifest shape) and
 * asserts BEHAVIOUR against the live runtime — it does not analyse code.
 *
 * Checks:
 *   boot      — dispatch every GET REST route in the manifest; fail any that 500s.
 *   contract  — for each oracle (oracles.json), flip the option/flag OFF then ON and assert the
 *               disabled error code appears when off, absent when on.
 *   candidate — surface the manifest's STATIC smells (option written-but-never-enforced,
 *               feature missing a layer, hook fired-but-no-listener) as UNCONFIRMED findings
 *               for a human/agent to confirm or add an oracle for. Never counted as pass/fail.
 *
 * Output: a single JSON ledger on stdout: { ok, summary{pass,fail,candidate}, rows[] }.
 *
 * No plugin classes are used — only WP core (rest_do_request, get_option, update_option).
 */

// phpcs:disable WordPress.Security.EscapeOutput, WordPress.PHP.DevelopmentFunctions

if ( ! defined( 'ABSPATH' ) ) {
	fwrite( STDERR, "cert-engine: must run via wp eval-file\n" );
	exit( 1 );
}

$cert_manifest_path = isset( $args[0] ) ? (string) $args[0] : '';
$cert_oracles_path  = isset( $args[1] ) ? (string) $args[1] : '';

$cert_manifest = $cert_manifest_path && is_readable( $cert_manifest_path )
	? json_decode( (string) file_get_contents( $cert_manifest_path ), true )
	: null;
if ( ! is_array( $cert_manifest ) ) {
	echo wp_json_encode( array( 'ok' => false, 'summary' => array( 'pass' => 0, 'fail' => 0, 'candidate' => 0 ), 'rows' => array(), 'error' => 'manifest unreadable' ) );
	exit( 0 );
}
$cert_oracles = $cert_oracles_path && is_readable( $cert_oracles_path )
	? json_decode( (string) file_get_contents( $cert_oracles_path ), true )
	: array();

$cert_features = isset( $cert_manifest['features'] ) && is_array( $cert_manifest['features'] ) ? $cert_manifest['features'] : array();
$cert_rows     = array();

// Authenticate as the primary admin so permission_callback gates pass and the FEATURE gate
// (which runs after auth) is what we probe.
if ( function_exists( 'wp_set_current_user' ) ) {
	wp_set_current_user( 1 );
}

/**
 * Internal REST dispatch with regex params replaced by "1". Throwable -> synthetic 500.
 */
$cert_dispatch = function ( $method, $route, $params ) {
	$route = preg_replace( '/\(\?P<[^>]+>[^)]*\)/', '1', $route );
	try {
		$req = new WP_REST_Request( $method, $route );
		foreach ( (array) $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		$res  = rest_do_request( $req );
		$data = $res->get_data();
		return array(
			'status' => (int) $res->get_status(),
			'code'   => ( is_array( $data ) && isset( $data['code'] ) ) ? (string) $data['code'] : '',
		);
	} catch ( \Throwable $t ) {
		return array( 'status' => 500, 'code' => 'throwable:' . $t->getMessage() );
	}
};

// ── boot: dispatch every GET route ──────────────────────────────────────────
$cert_routes = isset( $cert_features['restRoutes'] ) && is_array( $cert_features['restRoutes'] ) ? $cert_features['restRoutes'] : array();
foreach ( $cert_routes as $r ) {
	$methods = isset( $r['methods'] ) && is_array( $r['methods'] ) ? $r['methods'] : array();
	if ( ! in_array( 'GET', $methods, true ) ) {
		continue;
	}
	$ns    = isset( $r['namespace'] ) ? trim( (string) $r['namespace'], '/' ) : '';
	$route = isset( $r['route'] ) ? '/' . ltrim( (string) $r['route'], '/' ) : '';
	$full  = '/' . $ns . $route;
	$res   = $cert_dispatch( 'GET', $full, array() );
	$cert_rows[] = array(
		'check'  => 'boot',
		'entity' => 'GET ' . $full,
		'status' => ( $res['status'] < 500 ) ? 'pass' : 'fail',
		'detail' => 'status=' . $res['status'] . ( '' !== $res['code'] ? ' code=' . $res['code'] : '' ),
	);
}

// ── contract: behaviour-flip every oracle ───────────────────────────────────
$cert_oracle_rows = isset( $cert_oracles['contract'] ) && is_array( $cert_oracles['contract'] ) ? $cert_oracles['contract'] : array();
foreach ( $cert_oracle_rows as $o ) {
	$id       = isset( $o['id'] ) ? (string) $o['id'] : '';
	$kind     = isset( $o['kind'] ) ? (string) $o['kind'] : 'option';
	$off_code = isset( $o['off_code'] ) ? (string) $o['off_code'] : '';
	$route    = isset( $o['route'] ) ? (string) $o['route'] : '';
	$method   = isset( $o['method'] ) ? (string) $o['method'] : 'POST';
	$params   = isset( $o['params'] ) && is_array( $o['params'] ) ? $o['params'] : array();
	if ( '' === $id || '' === $route || '' === $off_code ) {
		continue;
	}

	$snap = ( 'feature' === $kind ) ? get_option( 'buddynext_features', '__cert_absent__' ) : get_option( $id, '__cert_absent__' );

	$cert_set = function ( $on ) use ( $id, $kind ) {
		if ( 'feature' === $kind ) {
			$opt = get_option( 'buddynext_features', array() );
			if ( ! is_array( $opt ) ) { $opt = array(); }
			$opt[ $id ] = $on;
			update_option( 'buddynext_features', $opt, false );
		} else {
			update_option( $id, $on ? '1' : '0', false );
		}
	};

	$cert_set( false );
	$off = $cert_dispatch( $method, $route, $params );
	$cert_set( true );
	$on = $cert_dispatch( $method, $route, $params );

	// Restore.
	$name = ( 'feature' === $kind ) ? 'buddynext_features' : $id;
	if ( '__cert_absent__' === $snap ) { delete_option( $name ); } else { update_option( $name, $snap, false ); }

	$pass = ( $off['code'] === $off_code ) && ( $on['code'] !== $off_code );
	$cert_rows[] = array(
		'check'  => 'contract',
		'entity' => $id,
		'status' => $pass ? 'pass' : 'fail',
		'detail' => 'off=' . ( '' === $off['code'] ? '-' : $off['code'] ) . '(' . $off['status'] . ') on=' . ( '' === $on['code'] ? '-' : $on['code'] ) . '(' . $on['status'] . ') expect off=' . $off_code,
	);
}

// ── candidates: static smells from manifest v2 (UNCONFIRMED) ─────────────────
$cert_covered = array();
foreach ( $cert_oracle_rows as $o ) { if ( isset( $o['id'] ) ) { $cert_covered[ (string) $o['id'] ] = true; } }

$cert_options = isset( $cert_features['optionsWiring'] ) && is_array( $cert_features['optionsWiring'] ) ? $cert_features['optionsWiring'] : array();
foreach ( $cert_options as $opt ) {
	$name = isset( $opt['optionName'] ) ? (string) $opt['optionName'] : '';
	$written  = isset( $opt['writtenAt'] ) ? count( (array) $opt['writtenAt'] ) : 0;
	$enforced = isset( $opt['enforcedAt'] ) ? count( (array) $opt['enforcedAt'] ) : 0;
	$read     = isset( $opt['readAt'] ) ? count( (array) $opt['readAt'] ) : 0;
	// Only boolean-toggle-SHAPED options are dead-toggle candidates — a stored value
	// (logo_url, db_version, signing_key) is "written but never enforced" by design and
	// is noise. Require a toggle-ish name AND that it IS read somewhere (a real feature gate).
	$looks_toggle = (bool) preg_match( '/(?:^|_)(allow|enable|disable|show|hide|is|has|require|toggle)_|_enabled$|_active$|_on$/', (string) $name );
	if ( $name && $looks_toggle && $written > 0 && $read > 0 && 0 === $enforced && empty( $cert_covered[ $name ] ) ) {
		$cert_rows[] = array(
			'check'  => 'candidate',
			'entity' => $name,
			'status' => 'candidate',
			'detail' => 'written but never enforced — possible dead toggle (add an oracle to confirm)',
		);
	}
}

$cert_groups = isset( $cert_features['featureGroups'] ) && is_array( $cert_features['featureGroups'] ) ? $cert_features['featureGroups'] : array();
foreach ( $cert_groups as $g ) {
	$missing = isset( $g['missingLayers'] ) ? (array) $g['missingLayers'] : array();
	if ( ! empty( $missing ) ) {
		$cert_rows[] = array(
			'check'  => 'candidate',
			'entity' => isset( $g['slug'] ) ? (string) $g['slug'] : '?',
			'status' => 'candidate',
			'detail' => 'feature may be missing layer(s): ' . implode( ',', $missing ) . ' — confirm UX/wiring',
		);
	}
}

// ── summary ──────────────────────────────────────────────────────────────────
$cert_summary = array( 'pass' => 0, 'fail' => 0, 'candidate' => 0 );
foreach ( $cert_rows as $row ) {
	$s = $row['status'];
	if ( isset( $cert_summary[ $s ] ) ) { ++$cert_summary[ $s ]; }
}
echo wp_json_encode( array(
	'ok'      => ( 0 === $cert_summary['fail'] ),
	'summary' => $cert_summary,
	'rows'    => $cert_rows,
) );
