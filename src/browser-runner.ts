/**
 * WP Plugin QA MCP Server - Browser Runner
 * Generates Playwright test scripts for admin pages, blocks, responsive testing.
 * Dual mode: generates scripts for Claude/manual execution OR returns test definitions.
 * Note: No shell commands or child processes used. Generates script files only.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue, PluginManifest } from './types.js';
import { generateTestId } from './shared-utils.js';

interface BrowserTestScript {
  name: string;
  description: string;
  script: string;
  category: string;
}

export function checkBrowser(manifest: PluginManifest, siteUrl: string, options?: { exportDir?: string }): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const baseUrl = siteUrl.replace(/\/$/, '');
  const scripts: BrowserTestScript[] = [];

  scripts.push(...generateAdminPageTests(manifest, baseUrl));
  scripts.push(...generateBlockTests(manifest, baseUrl));
  scripts.push(...generateResponsiveTests(manifest, baseUrl));
  scripts.push(...generateFormTests(manifest, baseUrl));
  scripts.push(...generateConsoleErrorTests(manifest, baseUrl));

  if (options?.exportDir) {
    const outputDir = join(options.exportDir, manifest.header.slug || 'plugin');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    for (const script of scripts) {
      const fileName = `${script.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.spec.ts`;
      writeFileSync(join(outputDir, fileName), script.script);
    }

    issues.push({
      id: generateTestId('browser'), category: 'browser', severity: 'low', type: 'info',
      title: `Generated ${scripts.length} Playwright test scripts`,
      message: `Scripts exported to ${outputDir}. Run with: npx playwright test`,
      file: outputDir, line: 0, code: 'scripts-exported',
    });
  } else {
    issues.push({
      id: generateTestId('browser'), category: 'browser', severity: 'low', type: 'info',
      title: `${scripts.length} browser tests defined`,
      message: 'Use exportDir option to generate Playwright scripts, or use webapp-testing skill to run interactively',
      file: '', line: 0, code: 'tests-defined',
    });
  }

  for (const page of manifest.features.adminPages) {
    if (!page.capability || page.capability === '') {
      issues.push({
        id: generateTestId('browser'), category: 'browser', severity: 'high', type: 'warning',
        title: `Admin page "${page.title}" may lack capability check`,
        message: 'Admin page registered without clear capability requirement',
        file: page.file, line: page.line, code: 'admin-page-no-capability',
      });
    }
  }

  return {
    category: 'browser',
    issues,
    passed: scripts.length,
    failed: issues.filter(i => i.type === 'error').length,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function generateAdminPageTests(manifest: PluginManifest, baseUrl: string): BrowserTestScript[] {
  const scripts: BrowserTestScript[] = [];
  const loginUrl = `${baseUrl}/?autologin=1`;

  for (const page of manifest.features.adminPages) {
    const pageUrl = `${baseUrl}/wp-admin/admin.php?page=${page.slug}`;
    scripts.push({
      name: `admin-page-${page.slug}`,
      description: `Test admin page: ${page.title}`,
      category: 'admin',
      script: `import { test, expect } from '@playwright/test';

test.describe('Admin Page: ${page.title}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${loginUrl}');
    await page.waitForLoadState('networkidle');
  });

  test('loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    const response = await page.goto('${pageUrl}');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');
    expect(errors).toHaveLength(0);
  });

  test('no PHP errors visible', async ({ page }) => {
    await page.goto('${pageUrl}');
    const content = await page.textContent('body');
    expect(content).not.toContain('Fatal error');
    expect(content).not.toContain('Warning:');
    expect(content).not.toContain('Parse error');
  });
});
`,
    });
  }

  return scripts;
}

function generateBlockTests(manifest: PluginManifest, baseUrl: string): BrowserTestScript[] {
  const scripts: BrowserTestScript[] = [];
  if (manifest.features.blocks.length === 0) return scripts;

  const loginUrl = `${baseUrl}/?autologin=1`;
  const editorUrl = `${baseUrl}/wp-admin/post-new.php`;

  for (const block of manifest.features.blocks) {
    scripts.push({
      name: `block-${block.name.replace('/', '-')}`,
      description: `Test Gutenberg block: ${block.title}`,
      category: 'block',
      script: `import { test, expect } from '@playwright/test';

test.describe('Block: ${block.title}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${loginUrl}');
    await page.waitForLoadState('networkidle');
  });

  test('can be inserted in editor', async ({ page }) => {
    await page.goto('${editorUrl}');
    await page.waitForSelector('.block-editor-writing-flow');

    // Open block inserter
    await page.click('[aria-label="Toggle block inserter"]');
    await page.fill('[placeholder="Search"]', '${block.title}');
    await page.waitForTimeout(500);

    const blockOption = page.locator('[class*="block-editor-block-types-list__item"]').first();
    if (await blockOption.isVisible()) {
      await blockOption.click();
      await page.waitForTimeout(1000);
      const blockInEditor = page.locator('[data-type="${block.name}"]');
      await expect(blockInEditor).toBeVisible();
    }
  });
});
`,
    });
  }

  return scripts;
}

function generateResponsiveTests(manifest: PluginManifest, baseUrl: string): BrowserTestScript[] {
  const scripts: BrowserTestScript[] = [];
  const loginUrl = `${baseUrl}/?autologin=1`;
  const viewports = [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1024, height: 768 },
  ];

  if (manifest.features.adminPages.length > 0) {
    const firstPage = manifest.features.adminPages[0];
    const pageUrl = `${baseUrl}/wp-admin/admin.php?page=${firstPage.slug}`;

    scripts.push({
      name: `responsive-admin-${firstPage.slug}`,
      description: `Responsive test for admin page: ${firstPage.title}`,
      category: 'responsive',
      script: `import { test, expect } from '@playwright/test';

const viewports = ${JSON.stringify(viewports, null, 2)};

test.describe('Responsive: ${firstPage.title}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${loginUrl}');
    await page.waitForLoadState('networkidle');
  });

  for (const vp of viewports) {
    test(\`renders at \${vp.name} (\${vp.width}x\${vp.height})\`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('${pageUrl}');
      await page.waitForLoadState('domcontentloaded');

      // Check no horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width + 20);
    });
  }
});
`,
    });
  }

  return scripts;
}

function generateFormTests(manifest: PluginManifest, baseUrl: string): BrowserTestScript[] {
  const scripts: BrowserTestScript[] = [];
  if (manifest.features.settings.length === 0) return scripts;

  const loginUrl = `${baseUrl}/?autologin=1`;

  for (const page of manifest.features.adminPages) {
    scripts.push({
      name: `form-${page.slug}`,
      description: `Form submission test for: ${page.title}`,
      category: 'form',
      script: `import { test, expect } from '@playwright/test';

test.describe('Form: ${page.title}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${loginUrl}');
    await page.waitForLoadState('networkidle');
  });

  test('form submits without error', async ({ page }) => {
    await page.goto('${baseUrl}/wp-admin/admin.php?page=${page.slug}');
    await page.waitForLoadState('domcontentloaded');

    const submitBtn = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForLoadState('domcontentloaded');

      const content = await page.textContent('body');
      expect(content).not.toContain('Fatal error');
      expect(content).not.toContain('has been blocked');
    }
  });
});
`,
    });
  }

  return scripts;
}

function generateConsoleErrorTests(manifest: PluginManifest, baseUrl: string): BrowserTestScript[] {
  const loginUrl = `${baseUrl}/?autologin=1`;
  const urls: { name: string; url: string }[] = [];

  for (const page of manifest.features.adminPages) {
    urls.push({ name: `admin-${page.slug}`, url: `${baseUrl}/wp-admin/admin.php?page=${page.slug}` });
  }

  if (urls.length === 0) {
    urls.push({ name: 'wp-admin', url: `${baseUrl}/wp-admin/` });
  }

  return [{
    name: 'console-errors',
    description: 'Check all pages for JS console errors',
    category: 'console',
    script: `import { test, expect } from '@playwright/test';

const pages = ${JSON.stringify(urls, null, 2)};

test.describe('Console Errors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${loginUrl}');
    await page.waitForLoadState('networkidle');
  });

  for (const p of pages) {
    test(\`no JS errors on \${p.name}\`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto(p.url);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);
      expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
    });
  }
});
`,
  }];
}
