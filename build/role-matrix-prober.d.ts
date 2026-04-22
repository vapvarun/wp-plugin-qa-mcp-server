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
export declare const DEFAULT_ROLES: RoleProfile[];
export declare function probeRoleMatrix(opts: ProbeRoleMatrixOptions): Promise<RoleMatrixReport>;
