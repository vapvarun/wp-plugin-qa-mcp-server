/**
 * WP Plugin QA MCP Server - Role Matrix REST/AJAX Prober
 *
 * Probes every discovered REST endpoint and AJAX action as each configured
 * WordPress role, comparing observed HTTP status to the expected one derived
 * from the route's permission_callback. Designed to catch capability/role
 * mismatches pre-release (e.g. advertiser-facing REST endpoints gated with
 * manage_options returning 403 to real users).
 *
 * Relies on the existing scanner for route discovery — does not duplicate
 * scanner logic. Uses Node 18+ fetch with 15s abort timeout. No dependencies.
 */

import { scanPlugin } from './scanner.js';
import { siteFetch } from './shared-utils.js';
import type { PluginManifest, RestRouteInfo, AjaxHandlerInfo } from './types.js';

// ─── Public Types ──────────────────────────────────────────────────

export type RoleAuthType = 'cookie' | 'application-password' | 'nonce' | 'none';

/**
 * 'unknown' = the callback body was not resolved, so no outcome can be
 * asserted. Such a probe is never a match; it only fails on a 5xx.
 */
export type ExpectedOutcome = 'success' | 'forbidden' | 'not-logged-in' | 'unknown';

/**
 * match / mismatch: the expectation was known and the probe ran.
 * unknown:  the probe ran, the expectation could not be derived.
 * not-run:  the role has no usable credentials, nothing was sent.
 * skipped:  the route could not be addressed (regex param with no sample value).
 */
export type Verdict = 'match' | 'mismatch' | 'unknown' | 'not-run' | 'skipped';

export type MatrixVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

export interface RoleCredentials {
  username?: string;
  appPassword?: string;
  cookieName?: string;
  cookieValue?: string;
}

export interface RoleProfile {
  id: string;
  label: string;
  authType: RoleAuthType;
  credentials?: RoleCredentials;
  expectedCapability: string;
}

export interface ProbeObservation {
  status: number;
  expected: ExpectedOutcome;
  verdict: Verdict;
  bodyExcerpt?: string;
}

export interface RoleMatrixRow {
  type: 'rest' | 'ajax';
  method: string;
  path: string;
  file: string;
  line: number;
  permissionCallback?: string;
  observedByRole: Record<string, ProbeObservation>;
}

export interface RoleMatrixReport {
  summary: {
    totalEndpoints: number;
    totalRoles: number;
    totalProbes: number;
    unexpectedStatuses: number;
    matched: number;
    /** Probes sent whose expected outcome could not be derived. Not a pass. */
    expectationUnknown: number;
    /** Probes never sent: the role had no usable credentials. */
    notRun: number;
    /** Routes that could not be addressed (regex param with no sample value). */
    skipped: number;
    /** Role ids that were not probed at all. */
    rolesNotRun: string[];
    /** PASS only when every probe ran, had a known expectation, and matched. */
    verdict: MatrixVerdict;
    timestamp: string;
  };
  endpoints: RoleMatrixRow[];
}

export interface ProbeRoleMatrixOptions {
  pluginPath: string;
  siteUrl: string;
  roles?: RoleProfile[];
  scanManifestCache?: PluginManifest;
}

// ─── Defaults ──────────────────────────────────────────────────────

export const DEFAULT_ROLES: RoleProfile[] = [
  {
    id: 'guest',
    label: 'Not logged in',
    authType: 'none',
    expectedCapability: '',
  },
  {
    id: 'subscriber',
    label: 'Subscriber',
    authType: 'application-password',
    credentials: { username: '', appPassword: '' },
    expectedCapability: 'read',
  },
  {
    id: 'editor',
    label: 'Editor',
    authType: 'application-password',
    credentials: { username: '', appPassword: '' },
    expectedCapability: 'edit_others_posts',
  },
  {
    id: 'admin',
    label: 'Administrator',
    authType: 'application-password',
    credentials: { username: '', appPassword: '' },
    expectedCapability: 'manage_options',
  },
];

// Note: callers pass their own `roles` array via the tool args to override
// these defaults. The defaults use application-password auth (RFC 7617 Basic
// over HTTPS, supported on every WordPress 5.6+ install) instead of a
// project-specific dev cookie. Site owners using a custom auth-bypass cookie
// can still pass it as `authType: 'cookie'` with their own `cookieName` /
// `cookieValue`.

const REQUEST_TIMEOUT_MS = 15_000;
const BODY_EXCERPT_LEN = 200;

// ─── Main Entry ────────────────────────────────────────────────────

export async function probeRoleMatrix(
  opts: ProbeRoleMatrixOptions
): Promise<RoleMatrixReport> {
  const roles = opts.roles && opts.roles.length > 0 ? opts.roles : DEFAULT_ROLES;
  const manifest = opts.scanManifestCache ?? scanPlugin(opts.pluginPath);
  const siteUrl = opts.siteUrl.replace(/\/+$/, '');

  const rows: RoleMatrixRow[] = [];

  // REST routes — one row per (route × method) combination.
  for (const route of manifest.features.restRoutes) {
    const methods = route.methods && route.methods.length > 0 ? route.methods : ['GET'];
    for (const method of methods) {
      rows.push(buildRestRow(route, method));
    }
  }

  // AJAX handlers — always POST.
  for (const handler of manifest.features.ajaxHandlers) {
    rows.push(buildAjaxRow(handler));
  }

  const counts: Record<Verdict, number> = { match: 0, mismatch: 0, unknown: 0, 'not-run': 0, skipped: 0 };

  for (const row of rows) {
    for (const role of roles) {
      const expected = deriveExpected(row.permissionCallback, role);
      const observation = await probeOne(siteUrl, row, role, expected);
      row.observedByRole[role.id] = observation;
      counts[observation.verdict]++;
    }
  }

  const rolesNotRun = roles.filter(r => buildAuthHeaders(r) === null).map(r => r.id);

  return {
    summary: {
      totalEndpoints: rows.length,
      totalRoles: roles.length,
      totalProbes: counts.match + counts.mismatch + counts.unknown,
      unexpectedStatuses: counts.mismatch,
      matched: counts.match,
      expectationUnknown: counts.unknown,
      notRun: counts['not-run'],
      skipped: counts.skipped,
      rolesNotRun,
      verdict: matrixVerdict(counts, rolesNotRun),
      timestamp: new Date().toISOString(),
    },
    endpoints: rows,
  };
}

/** A matrix passes only on evidence: any mismatch fails it, anything unchecked leaves it incomplete. */
export function matrixVerdict(counts: Record<Verdict, number>, rolesNotRun: string[]): MatrixVerdict {
  if (counts.mismatch > 0) return 'FAIL';
  if (rolesNotRun.length || counts.unknown || counts['not-run'] || counts.skipped || counts.match === 0) return 'INCOMPLETE';
  return 'PASS';
}

export function formatRoleMatrix(report: RoleMatrixReport): string {
  const s = report.summary;
  const lines = [
    `${s.verdict} wppqa_probe_roles: ${s.matched} match, ${s.unexpectedStatuses} mismatch, ${s.expectationUnknown} expectation unknown, ${s.notRun} not run, ${s.skipped} skipped`,
  ];
  if (s.rolesNotRun.length) lines.push(`NOT RUN - no usable credentials for role(s): ${s.rolesNotRun.join(', ')}. Pass roles[] with credentials to probe them.`);
  if (s.expectationUnknown) lines.push(`${s.expectationUnknown} probe(s) hit a callback whose rule the scanner could not resolve; they are reported, never counted as a match.`);
  if (s.skipped) lines.push(`${s.skipped} probe(s) skipped: the route has a regex parameter with no sample value.`);
  if (s.verdict === 'INCOMPLETE') lines.push('INCOMPLETE is not a pass: the role matrix is only partly verified.');
  return `${lines.join('\n')}\n\n${JSON.stringify(report, null, 2)}`;
}

// ─── Row Builders ──────────────────────────────────────────────────

function buildRestRow(route: RestRouteInfo, method: string): RoleMatrixRow {
  const ns = route.namespace.replace(/^\/+|\/+$/g, '');
  const path = route.route.startsWith('/') ? route.route : `/${route.route}`;
  const fullPath = `/${ns}${path}`.replace(/\/+/g, '/');

  return {
    type: 'rest',
    method: method.toUpperCase(),
    path: fullPath,
    file: route.file,
    line: route.line,
    permissionCallback: normalizePermissionCallback(route.permissionCallback),
    observedByRole: {},
  };
}

function buildAjaxRow(handler: AjaxHandlerInfo): RoleMatrixRow {
  return {
    type: 'ajax',
    method: 'POST',
    path: handler.action,
    file: handler.file,
    line: handler.line,
    // AJAX has no explicit permission_callback; the handler does its own
    // nonce + capability check, which this probe cannot read. Only "a guest
    // cannot reach a non-nopriv action" is derivable (see deriveExpected).
    permissionCallback: handler.loggedOut ? 'nopriv' : 'logged-in',
    observedByRole: {},
  };
}

function normalizePermissionCallback(raw: string | undefined): string {
  if (!raw) return '<unresolved>';
  if (raw === 'closure' || raw === 'unknown') return '<unresolved>';
  return raw;
}

// ─── Expected Outcome Derivation ───────────────────────────────────

export function deriveExpected(
  permissionCallback: string | undefined,
  role: RoleProfile
): ExpectedOutcome {
  const pc = (permissionCallback || '').trim();

  // Always-open routes.
  if (pc === '__return_true' || pc === '__return_false' /* rare, treat as still reachable */) {
    // __return_false would forbid all, but scanner reports __return_true as
    // the common open case. Default to success here.
    return pc === '__return_false' ? 'forbidden' : 'success';
  }

  // Logged-in-only routes.
  if (pc === 'is_user_logged_in') {
    return role.authType === 'none' ? 'not-logged-in' : 'success';
  }

  // Admin-only routes.
  if (isAdminOnlyCallback(pc)) {
    if (role.expectedCapability === 'manage_options') return 'success';
    if (role.authType === 'none') return 'not-logged-in';
    return 'forbidden';
  }

  // AJAX sentinels from buildAjaxRow. WordPress itself refuses a guest on an
  // action with no nopriv hook; what a logged-in role (or a guest on a nopriv
  // action) gets depends on the handler body, which is not known here.
  if (pc === 'logged-in' && role.authType === 'none') return 'not-logged-in';

  // nopriv / logged-in AJAX, closures, unresolved callbacks and named
  // callbacks whose rule is not recognised: nothing can be asserted.
  return 'unknown';
}

function isAdminOnlyCallback(pc: string): boolean {
  if (!pc) return false;
  // Direct capability string.
  if (pc === 'manage_options') return true;
  // Common method names used by Wbcom plugins that gate on manage_options.
  // Scanner returns the callback method name only, not its body, so we
  // match by convention. Callers with different naming can override via
  // the roles array / expected logic by supplying a resolved manifest.
  const adminNamePatterns = [
    /^check_admin_/i,
    /^is_admin$/i,
    /_admin_permission$/i,
    /^admin_permission/i,
    /^manage_options$/i,
  ];
  return adminNamePatterns.some(rx => rx.test(pc));
}

// ─── Probing ───────────────────────────────────────────────────────

async function probeOne(
  siteUrl: string,
  row: RoleMatrixRow,
  role: RoleProfile,
  expected: ExpectedOutcome
): Promise<ProbeObservation> {
  const authHeaders = buildAuthHeaders(role);
  if (authHeaders === null) {
    return {
      status: 0,
      expected,
      verdict: 'not-run',
      bodyExcerpt: `NOT RUN: role "${role.id}" has authType "${role.authType}" but credentials are missing or unusable.`,
    };
  }

  const url = buildUrl(siteUrl, row);
  if (url === null) {
    return {
      status: 0,
      expected,
      verdict: 'skipped',
      bodyExcerpt: 'SKIPPED: route has a regex parameter no sample value fits.',
    };
  }
  const sampled = row.type === 'rest' && row.path.includes('(');
  const method = row.method;
  const init: RequestInit = {
    method,
    headers: { ...authHeaders },
    // Disable redirect following so we observe true status (WP sometimes
    // 302s unauthenticated users to the login screen).
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = '{}';
  }

  let status = 0;
  let bodyExcerpt: string | undefined;
  try {
    // siteFetch allows LocalWP self-signed cert (*.local only) and returns `any`
    const res = await siteFetch(url, init);
    status = res.status;
    // Treat manual-redirect opaque responses as their raw status (0 -> fallthrough).
    if (status === 0) status = res.type === 'opaqueredirect' ? 302 : 0;
    // Read a small slice of the body for diagnostics.
    const text = await safeReadBody(res);
    bodyExcerpt = text.slice(0, BODY_EXCERPT_LEN);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      expected,
      verdict: 'mismatch',
      bodyExcerpt: `fetch failed: ${msg.slice(0, BODY_EXCERPT_LEN)}`,
    };
  }

  let verdict = classifyVerdict(status, expected, row.type);
  // A 404 on a route addressed with a made-up sample value says the sample
  // did not resolve (no such route match / no such object), not that the
  // permission rule held. Never a match, and not evidence of a bug either.
  if (sampled && status === 404) verdict = /rest_no_route/.test(bodyExcerpt ?? '') ? 'skipped' : 'unknown';
  const result: ProbeObservation = { status, expected, verdict };
  if (verdict !== 'match' && bodyExcerpt) {
    result.bodyExcerpt = bodyExcerpt;
  }
  return result;
}

const SAMPLE_VALUES = ['1', 'sample', 'sample-1'];

/**
 * Replace each `(?P<name>pattern)` with a sample value the pattern accepts.
 * Returns null when a parameter fits no sample, or regex syntax is left over:
 * such a route cannot be addressed and must be reported as skipped.
 */
export function substituteRouteParams(path: string): string | null {
  let ok = true;
  const out = path.replace(/\(\?P<\w+>((?:[^()]|\([^()]*\))*)\)/g, (_m, pattern: string) => {
    const sample = SAMPLE_VALUES.find(v => {
      try { return new RegExp(`^(?:${pattern})$`).test(v); } catch { return false; }
    });
    if (sample === undefined) ok = false;
    return sample ?? '';
  });
  return ok && !/[()\[\]\\+*?|^$]/.test(out) ? out : null;
}

function buildUrl(siteUrl: string, row: RoleMatrixRow): string | null {
  if (row.type === 'rest') {
    const raw = row.path.startsWith('/') ? row.path : `/${row.path}`;
    const path = substituteRouteParams(raw);
    return path === null ? null : `${siteUrl}/wp-json${path}`;
  }
  // AJAX.
  const action = encodeURIComponent(row.path);
  return `${siteUrl}/wp-admin/admin-ajax.php?action=${action}`;
}

function buildAuthHeaders(role: RoleProfile): Record<string, string> | null {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };

  switch (role.authType) {
    case 'none':
      return headers;

    case 'cookie': {
      const c = role.credentials;
      if (!c?.cookieName || !c?.cookieValue) return null;
      headers.Cookie = `${c.cookieName}=${c.cookieValue}`;
      return headers;
    }

    case 'application-password': {
      const c = role.credentials;
      if (!c?.username || !c?.appPassword) return null;
      const token = Buffer.from(`${c.username}:${c.appPassword}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
      return headers;
    }

    case 'nonce':
      // Nonce-only probing requires a live browser session to mint a nonce.
      // Out of scope for this tool — caller should supply cookie or
      // application-password instead. Mark as skippable.
      return null;

    default:
      return null;
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text || '';
  } catch {
    return '';
  }
}

// ─── Verdict Classification ────────────────────────────────────────

export function classifyVerdict(status: number, expected: ExpectedOutcome, type: 'rest' | 'ajax' = 'rest'): Verdict {
  if (status === 0) return 'mismatch';
  // A server error is a defect whatever the permission rule is.
  if (status >= 500) return 'mismatch';

  switch (expected) {
    case 'success':
      return status >= 200 && status < 300 ? 'match' : 'mismatch';
    case 'forbidden':
      // WP core returns 401 for guests hitting capability-gated routes and
      // 403 for authed users without the cap. Either is acceptable as
      // "not allowed" when we expected forbidden.
      return status === 401 || status === 403 ? 'match' : 'mismatch';
    case 'not-logged-in':
      // admin-ajax.php answers a guest on a non-nopriv action with 400 "0".
      return status === 401 || status === 403 || (type === 'ajax' && status === 400) ? 'match' : 'mismatch';
    default:
      return 'unknown';
  }
}
