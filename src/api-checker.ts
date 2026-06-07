/**
 * WP Plugin QA MCP Server - API Checker
 * REST endpoint + AJAX handler verification via HTTP.
 * Uses native Node.js fetch (no shell commands).
 */

import type { CheckerResult, CheckerIssue, PluginManifest } from './types.js';
import { generateTestId, siteFetch } from './shared-utils.js';

export async function checkApi(manifest: PluginManifest, siteUrl: string): Promise<CheckerResult> {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const baseUrl = siteUrl.replace(/\/$/, '');

  // Get auth cookie via auto-login
  let authCookie = '';
  let wpNonce = '';
  try {
    const loginResp = await siteFetch(`${baseUrl}/?autologin=1`, { redirect: 'manual' });

    // Extract cookies — compatible with Node 18+ (getSetCookie may not exist on older builds)
    let setCookies: string[] = [];
    if (typeof loginResp.headers.getSetCookie === 'function') {
      setCookies = loginResp.headers.getSetCookie();
    } else {
      // Fallback: parse raw set-cookie header
      const rawCookie = loginResp.headers.get('set-cookie');
      if (rawCookie) {
        setCookies = rawCookie.split(/,(?=\s*\w+=)/);
      }
    }
    authCookie = setCookies.filter(c => c.includes('wordpress_logged_in')).join('; ');

    // Get WP REST nonce by loading wp-admin page and extracting wpApiSettings.nonce
    if (authCookie) {
      const adminResp = await siteFetch(`${baseUrl}/wp-admin/`, {
        headers: { 'Cookie': authCookie },
      });
      if (adminResp.ok) {
        const adminHtml = await adminResp.text();
        // WP outputs: var wpApiSettings = {"root":"...","nonce":"abc123",...}
        const nonceMatch = adminHtml.match(/wpApiSettings\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/);
        if (nonceMatch) {
          wpNonce = nonceMatch[1];
        }
      }
    }
  } catch (e) {
    issues.push({
      id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
      title: 'Cannot connect to site',
      message: `Failed to connect to ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
      file: '', line: 0, code: 'site-unreachable',
    });
    return { category: 'api', issues, passed: 0, failed: 1, skipped: 0, duration: Date.now() - startTime };
  }

  // Test REST endpoints
  for (const route of manifest.features.restRoutes) {
    const endpoint = `${baseUrl}/wp-json/${route.namespace}${route.route}`;

    // Test authenticated request
    try {
      const authResp = await siteFetch(endpoint, {
        headers: {
          'Cookie': authCookie,
          'X-WP-Nonce': wpNonce,
        },
      });

      if (authResp.status >= 500) {
        issues.push({
          id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
          title: `REST ${route.route}: server error ${authResp.status}`,
          message: `Authenticated request to ${route.namespace}${route.route} returned ${authResp.status}`,
          file: route.file, line: route.line, code: 'rest-server-error',
        });
      }
    } catch (e) {
      issues.push({
        id: generateTestId('api'), category: 'api', severity: 'high', type: 'error',
        title: `REST ${route.route}: request failed`,
        message: `Failed to reach ${endpoint}: ${e instanceof Error ? e.message : String(e)}`,
        file: route.file, line: route.line, code: 'rest-request-failed',
      });
    }

    // Test unauthenticated request (for write endpoints)
    if (route.methods.some(m => ['POST', 'PUT', 'DELETE', 'PATCH'].includes(m))) {
      try {
        const unauthResp = await siteFetch(endpoint, { method: route.methods[0] });
        if (unauthResp.status === 200 || unauthResp.status === 201) {
          issues.push({
            id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
            title: `REST ${route.route}: write endpoint allows unauth access`,
            message: `${route.methods[0]} ${route.route} returned ${unauthResp.status} without authentication`,
            file: route.file, line: route.line, code: 'rest-unauth-write',
          });
        }
      } catch { /* connection error is ok for unauth test */ }
    }
  }

  // Test AJAX handlers
  const ajaxUrl = `${baseUrl}/wp-admin/admin-ajax.php`;

  for (const handler of manifest.features.ajaxHandlers) {
    // Test with auth + valid nonce
    try {
      const formData = new URLSearchParams();
      formData.append('action', handler.action);

      const authResp = await siteFetch(ajaxUrl, {
        method: 'POST',
        headers: {
          'Cookie': authCookie,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      const responseText = await authResp.text();

      // Check if response is 0 (handler not found / unauthorized)
      if (responseText === '0' || responseText === '-1') {
        issues.push({
          id: generateTestId('api'), category: 'api', severity: 'high', type: 'warning',
          title: `AJAX "${handler.action}": returns ${responseText}`,
          message: `Handler "${handler.action}" returned "${responseText}" - may indicate missing handler or failed nonce check`,
          file: handler.file, line: handler.line, code: 'ajax-returns-zero',
        });
      }

      // Check if response is valid JSON (if it looks like it should be)
      if (responseText.length > 0 && responseText !== '0' && responseText !== '-1') {
        try {
          JSON.parse(responseText);
        } catch {
          if (responseText.includes('<') && responseText.includes('>')) {
            issues.push({
              id: generateTestId('api'), category: 'api', severity: 'medium', type: 'warning',
              title: `AJAX "${handler.action}": returns HTML instead of JSON`,
              message: 'AJAX handler returns HTML/text instead of JSON. Use wp_send_json_success/error.',
              file: handler.file, line: handler.line, code: 'ajax-not-json',
            });
          }
        }
      }
    } catch (e) {
      issues.push({
        id: generateTestId('api'), category: 'api', severity: 'high', type: 'error',
        title: `AJAX "${handler.action}": request failed`,
        message: `Failed to call AJAX handler: ${e instanceof Error ? e.message : String(e)}`,
        file: handler.file, line: handler.line, code: 'ajax-request-failed',
      });
    }
  }

  const failed = issues.filter(i => i.type === 'error').length;
  const total = manifest.features.restRoutes.length + manifest.features.ajaxHandlers.length;
  const passed = Math.max(0, total - failed);

  return { category: 'api', issues, passed, failed, skipped: 0, duration: Date.now() - startTime };
}
