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
/** Fresh-install walk: every page answers, shows no PHP error, no empty list shell, and no broken plugin link. */
export declare function crawl(c: Ctx, p: CrawlPage): Promise<Row[]>;
