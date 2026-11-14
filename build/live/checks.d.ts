import type { CrawlPage, ParityCase, QaConfig, RoundtripCase, StatesCase, Surface, ThemeConfig } from './config.js';
import { type Sessions } from './browser.js';
import { type WpCli } from './wp.js';
export type Status = 'pass' | 'fail' | 'skip';
export interface Row {
    guard: string;
    status: Status;
    detail: string;
    where?: string;
    evidence?: string;
    /** A failure excused by an open card in audit/known-failures.json (status is then 'skip'). */
    known?: boolean;
    /** A limit of this run the reader must see even on a pass (e.g. a capped link walk). */
    note?: string;
}
export interface Ctx {
    cfg: QaConfig;
    cli: WpCli;
    sessions: Sessions;
    base: string;
    artifacts?: string;
}
/** Saving a form untouched must not change the record; flipping one checkbox must. */
export declare function roundtrip(c: Ctx, t: RoundtripCase): Promise<Row[]>;
/** Every write arg of the REST route must be settable from every entry point that edits the same record. */
export declare function parity(c: Ctx, t: ParityCase): Promise<Row[]>;
/** A seeded state must render the way the owner expects: offered, hidden, listed, or counted. */
export declare function states(c: Ctx, t: StatesCase): Promise<Row[]>;
export declare function presentation(c: Ctx, s: Surface, themes: ThemeConfig[], widths: number[]): Promise<Row[]>;
export declare const CRAWL_LINK_CAP = 60;
/** The same-origin links a crawl follows, capped; `total` says how many qualified so the cap is visible. */
export declare function crawlLinks(links: string[], origin: string, cap?: number): {
    check: string[];
    total: number;
};
interface Watchable {
    on(event: string, fn: (arg: any) => void): unknown;
}
/**
 * Collect everything a page reports as broken while it loads: uncaught JS
 * errors, console errors, and same-origin requests that fail or answer 4xx/5xx.
 */
export declare function watchPage(page: Watchable, origin: string): {
    js: string[];
    requests: string[];
};
/** Fresh-install walk: every page answers, shows no PHP error, no empty list shell, no JS/console error, no failed same-origin request, and no broken plugin link. */
export declare function crawl(c: Ctx, p: CrawlPage): Promise<Row[]>;
export {};
