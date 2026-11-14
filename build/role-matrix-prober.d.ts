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
import type { PluginManifest } from './types.js';
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
export declare const DEFAULT_ROLES: RoleProfile[];
export declare function probeRoleMatrix(opts: ProbeRoleMatrixOptions): Promise<RoleMatrixReport>;
/** A matrix passes only on evidence: any mismatch fails it, anything unchecked leaves it incomplete. */
export declare function matrixVerdict(counts: Record<Verdict, number>, rolesNotRun: string[]): MatrixVerdict;
export declare function formatRoleMatrix(report: RoleMatrixReport): string;
export declare function deriveExpected(permissionCallback: string | undefined, role: RoleProfile): ExpectedOutcome;
/**
 * Replace each `(?P<name>pattern)` with a sample value the pattern accepts.
 * Returns null when a parameter fits no sample, or regex syntax is left over:
 * such a route cannot be addressed and must be reported as skipped.
 */
export declare function substituteRouteParams(path: string): string | null;
export declare function classifyVerdict(status: number, expected: ExpectedOutcome, type?: 'rest' | 'ajax'): Verdict;
