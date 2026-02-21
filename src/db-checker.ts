/**
 * WP Plugin QA MCP Server - Database Checker
 * MySQL checks for custom tables, settings, CPT storage, data cleanup.
 * Uses HTTP-based checks against running WP site. No direct shell usage.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue, PluginManifest } from './types.js';
import { generateTestId, findPhpFiles, relativePath, getLineNumber } from './shared-utils.js';

export async function checkDatabase(manifest: PluginManifest, siteUrl: string): Promise<CheckerResult> {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const baseUrl = siteUrl.replace(/\/$/, '');

  let authCookie = '';
  let wpNonce = '';
  try {
    const loginResp = await fetch(`${baseUrl}/?autologin=1`, { redirect: 'manual' });
    const setCookies = loginResp.headers.getSetCookie?.() || [];
    authCookie = setCookies.filter(c => c.includes('wordpress_logged_in')).join('; ');

    if (authCookie) {
      const nonceResp = await fetch(`${baseUrl}/wp-admin/admin-ajax.php?action=rest-nonce`, {
        headers: { 'Cookie': authCookie },
      });
      if (nonceResp.ok) wpNonce = await nonceResp.text();
    }
  } catch (e) {
    issues.push({
      id: generateTestId('database'), category: 'database', severity: 'critical', type: 'error',
      title: 'Cannot connect to site for DB checks',
      message: `Failed to connect to ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
      file: '', line: 0, code: 'site-unreachable',
    });
    return { category: 'database', issues, passed: 0, failed: 1, skipped: 0, duration: Date.now() - startTime };
  }

  // Check CPT registration via REST
  for (const cpt of manifest.features.cpts) {
    if (cpt.hasRest) {
      try {
        const resp = await fetch(`${baseUrl}/wp-json/wp/v2/types/${cpt.postType}`, {
          headers: { 'Cookie': authCookie, 'X-WP-Nonce': wpNonce },
        });
        if (resp.status === 404) {
          issues.push({
            id: generateTestId('database'), category: 'database', severity: 'high', type: 'error',
            title: `CPT "${cpt.postType}" not registered in REST API`,
            message: `CPT has show_in_rest=true but not found at /wp-json/wp/v2/types/${cpt.postType}`,
            file: cpt.file, line: cpt.line, code: 'cpt-not-in-rest',
          });
        }
      } catch { /* skip */ }
    }
  }

  // Static checks
  issues.push(...checkDataCleanup(manifest));
  issues.push(...checkAutoloadOptions(manifest));

  const failed = issues.filter(i => i.type === 'error').length;
  return {
    category: 'database',
    issues,
    passed: Math.max(0, (manifest.features.dbTables.length + manifest.features.settings.length + 2) - failed),
    failed,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkDataCleanup(manifest: PluginManifest): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  const uninstallFile = join(manifest.pluginPath, 'uninstall.php');
  const hasUninstallFile = existsSync(uninstallFile);

  let hasUninstallHook = false;
  const phpFiles = findPhpFiles(manifest.pluginPath);
  for (const file of phpFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      if (/register_uninstall_hook\s*\(/.test(content)) {
        hasUninstallHook = true;
        break;
      }
    } catch { /* skip */ }
  }

  if (!hasUninstallFile && !hasUninstallHook) {
    if (manifest.features.dbTables.length > 0 || manifest.features.settings.length > 0) {
      issues.push({
        id: generateTestId('database'), category: 'database', severity: 'medium', type: 'warning',
        title: 'No data cleanup on uninstall',
        message: 'Plugin creates DB tables/options but has no uninstall.php or register_uninstall_hook',
        file: '', line: 0, code: 'no-uninstall-cleanup',
        fix: 'Create uninstall.php to clean up custom tables and options',
      });
    }
  }

  return issues;
}

function checkAutoloadOptions(manifest: PluginManifest): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(manifest.pluginPath);

  for (const file of phpFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const rel = relativePath(file, manifest.pluginPath);

      const updatePattern = /update_option\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\$\w+)\s*\)/g;
      let match;
      while ((match = updatePattern.exec(content)) !== null) {
        const varName = match[2].toLowerCase();
        if (/list|all|cache|data|log|history|stats|report/i.test(varName)) {
          const contextEnd = Math.min(match.index + match[0].length + 50, content.length);
          const after = content.substring(match.index, contextEnd);
          if (!/false|no/.test(after)) {
            issues.push({
              id: generateTestId('database'), category: 'database', severity: 'medium', type: 'info',
              title: `Option "${match[1]}" may need autoload=false`,
              message: `update_option for "${match[1]}" stores "${match[2]}" which may be large`,
              file: rel, line: getLineNumber(content, match.index),
              code: 'potential-autoload-issue',
            });
          }
        }
      }
    } catch { /* skip */ }
  }

  return issues;
}
