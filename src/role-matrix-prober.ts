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
import type { PluginManifest, RestRouteInfo, AjaxHandlerInfo } from './types.js';

// ─── Public Types ──────────────────────────────────────────────────

export type RoleAuthType = 'cookie' | 'application-password' | 'nonce' | 'none';

export type ExpectedOutcome = 'success' | 'forbidden' | 'not-logged-in';

export type Verdict = 'match' | 'mismatch' | 'skipped';

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
    authType: 'cookie',
    credentials: { cookieName: 'wbam_dev_as', cookieValue: 'subscriber' },
    expectedCapability: 'read',
  },
  {
    id: 'advertiser',
    label: 'Advertiser',
    authType: 'cookie',
    credentials: { cookieName: 'wbam_dev_as', cookieValue: 'localshop' },
    expectedCapability: 'read',
  },
  {
    id: 'admin',
    label: 'Administrator',
    authType: 'cookie',
    credentials: { cookieName: 'wbam_dev_as', cookieValue: 'admin' },
    expectedCapability: 'manage_options',
  },
];

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

  let unexpected = 0;
  let totalProbes = 0;

  for (const row of rows) {
    for (const role of roles) {
      const expected = deriveExpected(row.permissionCallback, role);
      const observation = await probeOne(siteUrl, row, role, expected);
      row.observedByRole[role.id] = observation;
      totalProbes++;
      if (observation.verdict === 'mismatch') unexpected++;
    }
  }

  return {
    summary: {
      totalEndpoints: rows.length,
      totalRoles: roles.length,
      totalProbes,
      unexpectedStatuses: unexpected,
      timestamp: new Date().toISOString(),
    },
    endpoints: rows,
  };
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
    // AJAX has no explicit permission_callback. Treat nopriv presence as
    // "guest allowed". The cap expectation derives from role semantics.
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

function deriveExpected(
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

  // AJAX sentinels from buildAjaxRow.
  if (pc === 'nopriv') return 'success';
  if (pc === 'logged-in') {
    return role.authType === 'none' ? 'not-logged-in' : 'success';
  }

  // Unresolved / closure / unknown callback — best-effort: admin should
  // succeed, everyone else is treated as success (so a 403 still flags as
  // mismatch for admin; non-admin mismatches will be visible too).
  if (pc === '<unresolved>') {
    return role.expectedCapability === 'manage_options' ? 'success' : 'success';
  }

  // Default fallback: assume logged-in required.
  return role.authType === 'none' ? 'not-logged-in' : 'success';
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
      verdict: 'skipped',
      bodyExcerpt: `Role "${role.id}" has authType "${role.authType}" but credentials are missing or unusable.`,
    };
  }

  const url = buildUrl(siteUrl, row);
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
    const res = await fetch(url, init);
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

  const verdict = classifyVerdict(status, expected);
  const result: ProbeObservation = { status, expected, verdict };
  if (verdict === 'mismatch' && bodyExcerpt) {
    result.bodyExcerpt = bodyExcerpt;
  }
  return result;
}

function buildUrl(siteUrl: string, row: RoleMatrixRow): string {
  if (row.type === 'rest') {
    const path = row.path.startsWith('/') ? row.path : `/${row.path}`;
    return `${siteUrl}/wp-json${path}`;
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

function classifyVerdict(status: number, expected: ExpectedOutcome): Verdict {
  if (status === 0) return 'mismatch';

  switch (expected) {
    case 'success':
      return status >= 200 && status < 300 ? 'match' : 'mismatch';
    case 'forbidden':
      // WP core returns 401 for guests hitting capability-gated routes and
      // 403 for authed users without the cap. Either is acceptable as
      // "not allowed" when we expected forbidden.
      return status === 401 || status === 403 ? 'match' : 'mismatch';
    case 'not-logged-in':
      return status === 401 || status === 403 ? 'match' : 'mismatch';
    default:
      return 'mismatch';
  }
}
