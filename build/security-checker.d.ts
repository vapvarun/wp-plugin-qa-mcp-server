/**
 * WP Plugin QA MCP Server - Security Deep Scanner
 * Goes beyond regex pattern matching to trace data flows and verify security chains.
 * Covers OWASP top vulnerabilities common in WordPress plugins:
 * XSS (47.7%), Broken Access Control (14.2%), CSRF (11.4%), SQL Injection, Object Injection.
 *
 * NOTE: This file contains regex patterns that match dangerous PHP function names
 * (eval, exec, system, etc.) for DETECTION purposes only — this scanner identifies
 * these patterns in scanned plugin code. It does not execute any shell commands.
 */
import type { CheckerResult } from './types.js';
export declare function checkSecurity(pluginPath: string): CheckerResult;
