/**
 * WP Plugin QA MCP Server - API Checker
 * REST endpoint + AJAX handler verification via HTTP.
 * Uses native Node.js fetch (no shell commands).
 */
import { generateTestId, siteFetch } from './shared-utils.js';
import { substituteRouteParams } from './role-matrix-prober.js';
export async function checkApi(manifest, siteUrl) {
    const startTime = Date.now();
    const issues = [];
    const baseUrl = siteUrl.replace(/\/$/, '');
    const total = manifest.features.restRoutes.length + manifest.features.ajaxHandlers.length;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    // Get auth cookie via auto-login
    let authCookie = '';
    let wpNonce = '';
    try {
        const loginResp = await siteFetch(`${baseUrl}/?autologin=1`, { redirect: 'manual' });
        // Extract cookies — compatible with Node 18+ (getSetCookie may not exist on older builds)
        let setCookies = [];
        if (typeof loginResp.headers.getSetCookie === 'function') {
            setCookies = loginResp.headers.getSetCookie();
        }
        else {
            // Fallback: parse raw set-cookie header
            const rawCookie = loginResp.headers.get('set-cookie');
            if (rawCookie) {
                setCookies = rawCookie.split(/,(?=\s*\w+=)/);
            }
        }
        authCookie = setCookies.filter(c => c.includes('wordpress_logged_in')).map(c => c.split(';')[0].trim()).join('; ');
        if (!authCookie) {
            // Without a session every "authenticated" request below would run as a
            // guest and 401s would read as healthy. Refuse to report on that.
            issues.push({
                id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
                title: 'Autologin failed - no checks were run',
                message: `${baseUrl}/?autologin=1 set no wordpress_logged_in cookie (HTTP ${loginResp.status}). Install the dev-auto-login mu-plugin or check the site URL.`,
                file: '', line: 0, code: 'autologin-failed',
            });
            return { category: 'api', issues, passed: 0, failed: 1, skipped: total, duration: Date.now() - startTime };
        }
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
    }
    catch (e) {
        issues.push({
            id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
            title: 'Cannot connect to site',
            message: `Failed to connect to ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
            file: '', line: 0, code: 'site-unreachable',
        });
        return { category: 'api', issues, passed: 0, failed: 1, skipped: total, duration: Date.now() - startTime };
    }
    // Test REST endpoints
    for (const route of manifest.features.restRoutes) {
        const errorsBefore = issues.filter(i => i.type === 'error').length;
        // A route with a regex parameter is addressed with a sample value; one no
        // sample fits is skipped, never requested as a literal regex (a 404 there
        // would otherwise count as a pass).
        const path = substituteRouteParams(`/${route.namespace}/${route.route}`.replace(/\/+/g, '/'));
        if (path === null) {
            skipped++;
            issues.push({
                id: generateTestId('api'), category: 'api', severity: 'low', type: 'info',
                title: `REST ${route.route}: skipped`,
                message: 'Route has a regex parameter no sample value fits; it was not requested.',
                file: route.file, line: route.line, code: 'rest-route-skipped',
            });
            continue;
        }
        const endpoint = `${baseUrl}/wp-json${path}`;
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
        }
        catch (e) {
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
                if (unauthResp.status >= 200 && unauthResp.status < 300) {
                    issues.push({
                        id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
                        title: `REST ${route.route}: write endpoint allows unauth access`,
                        message: `${route.methods[0]} ${route.route} returned ${unauthResp.status} without authentication`,
                        file: route.file, line: route.line, code: 'rest-unauth-write',
                    });
                }
            }
            catch (e) {
                issues.push({
                    id: generateTestId('api'), category: 'api', severity: 'high', type: 'error',
                    title: `REST ${route.route}: unauthenticated request failed`,
                    message: `Could not send unauthenticated ${route.methods[0]} to ${endpoint}, so the write guard is unverified: ${e instanceof Error ? e.message : String(e)}`,
                    file: route.file, line: route.line, code: 'rest-unauth-request-failed',
                });
            }
        }
        if (issues.filter(i => i.type === 'error').length > errorsBefore)
            failed++;
        else
            passed++;
    }
    // Test AJAX handlers
    const ajaxUrl = `${baseUrl}/wp-admin/admin-ajax.php`;
    for (const handler of manifest.features.ajaxHandlers) {
        const errorsBefore = issues.filter(i => i.type === 'error').length;
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
            if (authResp.status >= 500) {
                issues.push({
                    id: generateTestId('api'), category: 'api', severity: 'critical', type: 'error',
                    title: `AJAX "${handler.action}": server error ${authResp.status}`,
                    message: `Authenticated call to "${handler.action}" returned ${authResp.status}`,
                    file: handler.file, line: handler.line, code: 'ajax-server-error',
                });
            }
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
                }
                catch {
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
        }
        catch (e) {
            issues.push({
                id: generateTestId('api'), category: 'api', severity: 'high', type: 'error',
                title: `AJAX "${handler.action}": request failed`,
                message: `Failed to call AJAX handler: ${e instanceof Error ? e.message : String(e)}`,
                file: handler.file, line: handler.line, code: 'ajax-request-failed',
            });
        }
        if (issues.filter(i => i.type === 'error').length > errorsBefore)
            failed++;
        else
            passed++;
    }
    // Counted per endpoint as it is checked: a skipped route is not a pass.
    return { category: 'api', issues, passed, failed, skipped, duration: Date.now() - startTime };
}
//# sourceMappingURL=api-checker.js.map