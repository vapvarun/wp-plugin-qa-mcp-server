import { type Browser, type Page } from 'playwright-core';
import type { QaConfig, ThemeConfig } from './config.js';
import { type WpCli } from './wp.js';
export declare function launch(): Promise<Browser>;
export declare function installThemeSwitch(cli: WpCli, themes?: ThemeConfig[]): void;
export declare function removeThemeSwitch(cli: WpCli): void;
export interface SessionKey {
    persona: string;
    theme?: ThemeConfig;
    dark: boolean;
    width: number;
}
export declare class Sessions {
    private browser;
    private cfg;
    private open;
    constructor(browser: Browser, cfg: QaConfig);
    page(key: SessionKey): Promise<Page>;
    private create;
    private login;
    /** Dark contexts are switched back to light: some themes save the choice to the user's account. */
    close(): Promise<void>;
}
export declare function gotoReady(page: Page, url: string, open?: string): Promise<number>;
