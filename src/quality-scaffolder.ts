/**
 * Quality Scaffolder — creates config files for code quality tools.
 * Given a plugin_path, generates .phpcs.xml.dist, phpstan.neon,
 * .eslintrc.json, .eslintignore, .stylelintrc.json, .editorconfig, .pa11yci.
 *
 * Smart features:
 * - Reads plugin header for text domain and WP version
 * - Greps wp_localize_script calls to find JS globals for ESLint
 * - Checks if files already exist (skips with message)
 * - Adds phpstan dev dependencies to composer.json if missing
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { findPhpFiles, safeReadFile, detectPluginSlug } from './shared-utils.js';

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  updated: string[];
  errors: string[];
}

// ─── Main Scaffolder ────────────────────────────────────────────

export function scaffoldQualityConfigs(pluginPath: string, siteUrl?: string): ScaffoldResult {
  const result: ScaffoldResult = { created: [], skipped: [], updated: [], errors: [] };

  const slug = detectPluginSlug(pluginPath);
  const textDomain = detectTextDomain(pluginPath) || slug;
  const minWpVersion = detectMinWpVersion(pluginPath) || '5.8';
  const jsGlobals = detectJsGlobals(pluginPath);

  // 1. .phpcs.xml.dist
  writeIfMissing(join(pluginPath, '.phpcs.xml.dist'), generatePhpcsConfig(textDomain, minWpVersion), result);

  // 2. phpstan.neon
  writeIfMissing(join(pluginPath, 'phpstan.neon'), generatePhpstanConfig(pluginPath, slug), result);

  // 3. .eslintrc.json
  writeIfMissing(join(pluginPath, '.eslintrc.json'), generateEslintConfig(jsGlobals), result);

  // 4. .eslintignore
  writeIfMissing(join(pluginPath, '.eslintignore'), generateEslintIgnore(), result);

  // 5. .stylelintrc.json
  writeIfMissing(join(pluginPath, '.stylelintrc.json'), generateStylelintConfig(), result);

  // 6. .editorconfig
  writeIfMissing(join(pluginPath, '.editorconfig'), generateEditorConfig(), result);

  // 7. .pa11yci (only if site_url provided)
  if (siteUrl) {
    writeIfMissing(join(pluginPath, '.pa11yci'), generatePa11yConfig(siteUrl), result);
  }

  // 8. Update composer.json with phpstan if missing
  updateComposerForPhpstan(pluginPath, result);

  return result;
}

// ─── File Writer ────────────────────────────────────────────────

function writeIfMissing(filePath: string, content: string, result: ScaffoldResult): void {
  const fileName = basename(filePath);
  if (existsSync(filePath)) {
    result.skipped.push(fileName);
    return;
  }
  try {
    writeFileSync(filePath, content, 'utf-8');
    result.created.push(fileName);
  } catch (err) {
    const e = err as { message?: string };
    result.errors.push(`${fileName}: ${e.message || 'write failed'}`);
  }
}

// ─── Detectors ──────────────────────────────────────────────────

function detectTextDomain(pluginPath: string): string | null {
  const slug = detectPluginSlug(pluginPath);
  const mainFile = join(pluginPath, `${slug}.php`);
  const content = safeReadFile(mainFile);
  if (!content) return null;
  const match = content.match(/Text\s+Domain:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function detectMinWpVersion(pluginPath: string): string | null {
  const slug = detectPluginSlug(pluginPath);
  const mainFile = join(pluginPath, `${slug}.php`);
  let content = safeReadFile(mainFile);
  if (!content) {
    content = safeReadFile(join(pluginPath, 'readme.txt'));
    if (!content) return null;
  }
  const match = content.match(/Requires\s+at\s+least:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

export function detectJsGlobals(pluginPath: string): string[] {
  const globals = new Set<string>(['wp', 'ajaxurl', 'jQuery']);
  const phpFiles = findPhpFiles(pluginPath);

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;

    const pattern = /wp_localize_script\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      globals.add(match[1]);
    }

    const inlinePattern = /wp_add_inline_script\s*\([^,]+,\s*['"]var\s+(\w+)/g;
    while ((match = inlinePattern.exec(content)) !== null) {
      globals.add(match[1]);
    }
  }

  return Array.from(globals).sort();
}

// ─── Config Generators ──────────────────────────────────────────

function generatePhpcsConfig(textDomain: string, minWpVersion: string): string {
  return `<?xml version="1.0"?>
<ruleset name="Plugin Coding Standards">
\t<description>PHPCS ruleset for ${textDomain}</description>

\t<!-- What to scan -->
\t<file>.</file>

\t<!-- Exclude -->
\t<exclude-pattern>/vendor/*</exclude-pattern>
\t<exclude-pattern>/node_modules/*</exclude-pattern>
\t<exclude-pattern>/build/*</exclude-pattern>
\t<exclude-pattern>/dist/*</exclude-pattern>
\t<exclude-pattern>/assets/js/*.min.js</exclude-pattern>
\t<exclude-pattern>/assets/css/*.min.css</exclude-pattern>

\t<arg name="extensions" value="php"/>
\t<arg value="sp"/>
\t<arg name="colors"/>

\t<rule ref="WordPress"/>

\t<rule ref="WordPress.WP.I18n">
\t\t<properties>
\t\t\t<property name="text_domain" type="array">
\t\t\t\t<element value="${textDomain}"/>
\t\t\t</property>
\t\t</properties>
\t</rule>

\t<config name="minimum_supported_wp_version" value="${minWpVersion}"/>
</ruleset>
`;
}

function generatePhpstanConfig(pluginPath: string, slug: string): string {
  const mainFile = `${slug}.php`;
  const hasIncludes = existsSync(join(pluginPath, 'includes'));
  const hasSrc = existsSync(join(pluginPath, 'src'));
  const hasComposerAutoload = existsSync(join(pluginPath, 'vendor', 'autoload.php'));

  const paths: string[] = [];
  if (hasIncludes) paths.push('        - includes');
  if (hasSrc) paths.push('        - src');
  paths.push(`        - ${mainFile}`);

  let config = `includes:
    - vendor/szepeviktor/phpstan-wordpress/extension.neon

parameters:
    level: 5
    paths:
${paths.join('\n')}
    scanDirectories:
        - ../../..
    excludePaths:
        - vendor
        - node_modules
`;

  if (hasComposerAutoload) {
    config += `    bootstrapFiles:
        - vendor/autoload.php
`;
  }

  return config;
}

function generateEslintConfig(globals: string[]): string {
  const globalsObj: Record<string, string> = {};
  for (const g of globals) {
    globalsObj[g] = 'readonly';
  }

  const config = {
    env: { browser: true, jquery: true },
    globals: globalsObj,
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'eqeqeq': 'warn',
      'no-console': 'warn',
      'no-redeclare': 'error',
    },
  };

  return JSON.stringify(config, null, '\t') + '\n';
}

function generateEslintIgnore(): string {
  return `**/*.min.js\nvendor/\nnode_modules/\nbuild/\ndist/\n`;
}

function generateStylelintConfig(): string {
  const config = {
    extends: 'stylelint-config-standard',
    rules: { 'no-descending-specificity': null, 'selector-class-pattern': null, 'selector-id-pattern': null },
    ignoreFiles: ['assets/css/*.min.css', 'vendor/**', 'node_modules/**'],
  };
  return JSON.stringify(config, null, '\t') + '\n';
}

function generateEditorConfig(): string {
  return `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = tab
indent_size = 4

[*.{yml,yaml,json}]
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
`;
}

function generatePa11yConfig(siteUrl: string): string {
  const baseUrl = siteUrl.replace(/\/$/, '');
  const config = {
    defaults: { standard: 'WCAG2AA', timeout: 30000, wait: 1000 },
    urls: [
      `${baseUrl}/?autologin=1`,
      `${baseUrl}/wp-admin/plugins.php?autologin=1`,
    ],
  };
  return JSON.stringify(config, null, '\t') + '\n';
}

// ─── Composer.json Updater ──────────────────────────────────────

function updateComposerForPhpstan(pluginPath: string, result: ScaffoldResult): void {
  const composerPath = join(pluginPath, 'composer.json');

  if (!existsSync(composerPath)) {
    const slug = detectPluginSlug(pluginPath);
    const composer = {
      name: `wbcom/${slug}`,
      type: 'wordpress-plugin',
      license: 'GPL-2.0-or-later',
      require: { php: '>=7.4' },
      'require-dev': {
        'phpstan/phpstan': '^2.1',
        'szepeviktor/phpstan-wordpress': '^2.0',
      },
    };
    try {
      writeFileSync(composerPath, JSON.stringify(composer, null, '\t') + '\n', 'utf-8');
      result.created.push('composer.json');
    } catch (err) {
      const e = err as { message?: string };
      result.errors.push(`composer.json: ${e.message || 'write failed'}`);
    }
    return;
  }

  try {
    const content = readFileSync(composerPath, 'utf-8');
    const composer = JSON.parse(content);
    const requireDev = composer['require-dev'] || {};
    let updated = false;

    if (!requireDev['phpstan/phpstan']) { requireDev['phpstan/phpstan'] = '^2.1'; updated = true; }
    if (!requireDev['szepeviktor/phpstan-wordpress']) { requireDev['szepeviktor/phpstan-wordpress'] = '^2.0'; updated = true; }

    if (updated) {
      composer['require-dev'] = requireDev;
      writeFileSync(composerPath, JSON.stringify(composer, null, '\t') + '\n', 'utf-8');
      result.updated.push('composer.json (added phpstan dev deps)');
    } else {
      result.skipped.push('composer.json (phpstan already present)');
    }
  } catch (err) {
    const e = err as { message?: string };
    result.errors.push(`composer.json: ${e.message || 'parse/update failed'}`);
  }
}
