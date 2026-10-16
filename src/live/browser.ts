/**
 * Browser sessions for live checks: one context per persona × theme × scheme × width.
 *
 * Theme switching is per request (a cookie read by a temporary mu-plugin), so a
 * check never changes the theme other people on the same site are using. Dark
 * mode is entered through the theme's own toggle, never by forcing a class:
 * forcing a class once passed a plugin whose dark styles missed the theme's
 * real selector.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { QaConfig, ThemeConfig } from './config.js';
import { wpEval, type WpCli } from './wp.js';

/** Playwright's own browser if downloaded, else any installed Playwright Chromium, else WPPQA_CHROMIUM. */
function executablePath(): string | undefined {
  if (process.env.WPPQA_CHROMIUM) return process.env.WPPQA_CHROMIUM;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const linux = join(homedir(), '.cache', 'ms-playwright');
  for (const root of [cache, linux]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).sort().reverse()) {
      for (const rel of [
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-headless-shell-mac-x64/chrome-headless-shell',
        'chrome-headless-shell-linux64/chrome-headless-shell',
      ]) {
        const p = join(root, d, rel);
        if (d.startsWith('chromium_headless_shell-') && existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ headless: true, executablePath: executablePath() });
}

const SWITCH_FILE = 'wppqa-theme-switch.php';
const switchPhp = (mods: Record<string, Record<string, unknown>>) => `<?php
// Temporary, written by the wp-plugin-qa MCP and removed when its run ends.
// Renders a request with the theme named in the wppqa_theme cookie, plus that theme's
// test-only theme mods (e.g. a dark toggle a theme ships switched off). Nobody else is affected.
if ( empty( $_COOKIE['wppqa_theme'] ) ) { return; }
$wppqa_theme = wp_get_theme( sanitize_key( wp_unslash( $_COOKIE['wppqa_theme'] ) ) );
if ( ! $wppqa_theme->exists() ) { return; }
add_filter( 'pre_option_stylesheet', fn() => $wppqa_theme->get_stylesheet() );
add_filter( 'pre_option_template', fn() => $wppqa_theme->get_template() );
$wppqa_mods = json_decode( base64_decode( '${Buffer.from(JSON.stringify(mods)).toString('base64')}' ), true );
foreach ( (array) ( $wppqa_mods[ $wppqa_theme->get_stylesheet() ] ?? array() ) as $wppqa_k => $wppqa_v ) {
	add_filter( "theme_mod_{$wppqa_k}", fn() => $wppqa_v );
}
`;

export function installThemeSwitch(cli: WpCli, themes: ThemeConfig[] = []): void {
  const mods = Object.fromEntries(themes.filter((t) => t.mods).map((t) => [t.slug, t.mods!]));
  wpEval(cli, `wp_mkdir_p( WPMU_PLUGIN_DIR ); return false !== file_put_contents( WPMU_PLUGIN_DIR . '/${SWITCH_FILE}', $vars['php'] );`, { php: switchPhp(mods) });
}

export function removeThemeSwitch(cli: WpCli): void {
  wpEval(cli, `$f = WPMU_PLUGIN_DIR . '/${SWITCH_FILE}'; return file_exists( $f ) ? unlink( $f ) : true;`);
}

export interface SessionKey { persona: string; theme?: ThemeConfig; dark: boolean; width: number }

export class Sessions {
  private open = new Map<string, BrowserContext>();
  constructor(private browser: Browser, private cfg: QaConfig) {}

  async page(key: SessionKey): Promise<Page> {
    const id = `${key.persona}|${key.theme?.slug ?? ''}|${key.dark}|${key.width}`;
    let ctx = this.open.get(id);
    if (!ctx) {
      ctx = await this.create(key);
      this.open.set(id, ctx);
    }
    return ctx.newPage();
  }

  private async create(key: SessionKey): Promise<BrowserContext> {
    const phone = key.width < 600;
    const ctx = await this.browser.newContext({
      viewport: { width: key.width, height: phone ? 844 : 900 },
      isMobile: phone,
      hasTouch: phone,
      ignoreHTTPSErrors: true,
    });
    const host = new URL(this.cfg.base_url).hostname;
    if (key.theme) await ctx.addCookies([{ name: 'wppqa_theme', value: key.theme.slug, domain: host, path: '/' }]);
    const page = await ctx.newPage();
    await this.login(page, key.persona);
    if (key.dark) await setScheme(page, this.cfg.base_url, key.theme, 'dark');
    await page.close();
    return ctx;
  }

  private async login(page: Page, persona: string): Promise<void> {
    if (persona === 'anonymous') return;
    const p = this.cfg.personas[persona];
    if (!p) throw new Error(`persona "${persona}" is not in qa-config personas`);
    if (p.password && p.login) {
      await page.goto(`${this.cfg.base_url}/wp-login.php`);
      await page.fill('#user_login', p.login);
      await page.fill('#user_pass', p.password);
      await Promise.all([page.waitForNavigation(), page.click('#wp-submit')]);
    } else if (p.autologin) {
      await page.goto(`${this.cfg.base_url}/?${this.cfg.autologin_param}=${encodeURIComponent(p.autologin)}`);
    } else {
      throw new Error(`persona "${persona}" has neither autologin nor login+password (put the password in docs/qa/qa-config.local.json, gitignored)`);
    }
    const logged = (await page.context().cookies()).some((c) => c.name.startsWith('wordpress_logged_in_'));
    if (!logged) throw new Error(`login as "${persona}" did not set a WordPress session cookie`);
  }

  /** Dark contexts are switched back to light: some themes save the choice to the user's account. */
  async close(): Promise<void> {
    for (const [id, ctx] of this.open) {
      const [, slug, dark] = id.split('|');
      const theme = this.cfg.themes.find((t) => t.slug === slug);
      if (dark === 'true' && theme?.dark) {
        const page = await ctx.newPage();
        await setScheme(page, this.cfg.base_url, theme, 'light').catch(() => undefined);
      }
      await ctx.close();
    }
    this.open.clear();
  }
}

async function setScheme(page: Page, base: string, theme: ThemeConfig | undefined, want: 'dark' | 'light'): Promise<void> {
  if (!theme?.dark) throw new Error(`theme "${theme?.slug}" has no dark toggle configured`);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  // Themes render the toggle more than once (desktop bar, mobile bar, menu); only one is visible per width.
  const btn = page.locator(`${theme.dark.toggle}:visible`).first();
  for (let i = 0; i < 4; i++) {
    const isDark = await page.locator(theme.dark.until).count();
    const mode = await btn.getAttribute('data-mode').catch(() => null);
    if (want === 'dark' ? isDark > 0 : !isDark && (mode === null || mode === 'light')) return;
    if (!(await btn.count())) throw new Error(`${theme.slug}: dark toggle "${theme.dark.toggle}" is not visible on the page; enable it in the theme`);
    await btn.click();
    await page.waitForTimeout(300);
  }
  throw new Error(`${theme.slug}: toggle did not reach ${want} ("${theme.dark.until}")`);
}

export async function gotoReady(page: Page, url: string, open?: string): Promise<number> {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  if (open) {
    await page.click(open);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => document.fonts.ready);
  return res?.status() ?? 0;
}
