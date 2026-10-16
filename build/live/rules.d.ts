/**
 * Presentation rules evaluated inside the page. Each one is a bug shape that
 * reached human QA because no gate looked at the rendered page: text the theme
 * made unreadable, a light card left on a dark theme, a nested card that merges
 * into its parent, theme bullets on plugin lists, a theme sidebar on a plugin
 * page, an admin page whose only heading is screen-reader text.
 *
 * The function is serialised into the page, so it must not reference anything
 * outside its own body.
 */
import type { Assertion } from './config.js';
export interface RuleArgs {
    root: string;
    kind: 'front' | 'admin';
    dark: boolean;
    sidebar?: string;
    fullWidth?: boolean;
    width: number;
    assertions: Assertion[];
}
export interface RuleFailure {
    rule: string;
    detail: string;
}
export declare function pageRules(a: RuleArgs): RuleFailure[];
/** Fresh-install shapes: a list container rendered with nothing in it, and visible PHP errors. */
export declare function walkRules(root: string): RuleFailure[];
