export type CheckClass = 'roundtrip' | 'parity' | 'states' | 'presentation' | 'crawl' | 'release';
export declare const CHECK_CLASSES: CheckClass[];
export interface Persona {
    /** Value for the site's autologin param (user id or login). */
    autologin?: string;
    /** wp-login.php credentials, for wp-admin screens that refuse autologin cookies. */
    login?: string;
    password?: string;
}
export interface ThemeConfig {
    slug: string;
    /** The theme's own dark toggle: click `toggle` until `until` matches. Omit for themes with no dark mode. */
    dark?: {
        toggle: string;
        until: string;
    };
    /** Theme sidebar selector, asserted hidden on surfaces marked full_width. */
    sidebar?: string;
    /** Theme mods applied only to check requests, e.g. a dark toggle the theme ships off. */
    mods?: Record<string, unknown>;
}
/** PHP run through `wp eval`; must `return` a JSON-serialisable value. */
export type Php = string;
export interface RoundtripCase {
    id: string;
    persona: string;
    setup: Php;
    teardown: Php;
    /** Returns the stored record as a flat object; compared before and after each submit. */
    read: Php;
    url: string;
    form: string;
    submit: string;
    /** Checkbox selectors flipped one at a time; each flip must change the stored record. */
    toggles?: string[];
    /** Stored keys a save may normalise without changing behaviour; say why in ignore_reason. */
    ignore?: string[];
    ignore_reason?: string;
}
export interface EntryPoint {
    name: string;
    persona: string;
    url: string;
    form: string;
    open?: string;
}
export interface ParityCase {
    id: string;
    /** REST route whose write args define the full field set, e.g. "/wpcp/v1/services". */
    rest: {
        route: string;
        method?: string;
    };
    entry_points: EntryPoint[];
    /** REST args no form should expose (ids, context, server-set fields). */
    ignore?: string[];
    /** Per entry point, args that are intentionally absent there. */
    allow?: Record<string, string[]>;
}
export interface Expectation {
    selector: string;
    count?: number;
    min?: number;
    absent?: boolean;
    text?: string;
}
export interface StatesCase {
    id: string;
    persona: string;
    setup?: Php;
    teardown?: Php;
    url: string;
    open?: string;
    expect: Expectation[];
}
export interface Assertion {
    type: 'box' | 'within' | 'gap';
    selector?: string;
    container?: string;
    a?: string;
    b?: string;
    min_width?: number;
    max_width?: number;
    max?: number;
    /** Only assert at viewports at least this wide. */
    from_width?: number;
}
export interface Surface {
    id: string;
    persona: string;
    url: string;
    kind: 'front' | 'admin';
    /** The plugin's own root element on the page; generic rules run inside it. */
    root: string;
    open?: string;
    full_width?: boolean;
    /** Pin this surface to these theme slugs in every mode (a guard for one theme's own selector). */
    themes?: string[];
    setup?: Php;
    teardown?: Php;
    assert?: Assertion[];
}
export interface CrawlPage {
    url: string;
    persona: string;
    open?: string;
    root?: string;
}
export interface ReleaseConfig {
    pot?: string;
    domain?: string;
    /** Path prefixes the release zip excludes; shipped code must not depend on them unguarded. */
    excluded?: string[];
    /** Build scripts whose make-pot step must fail loudly. */
    build_scripts?: string[];
    allow_refs?: string[];
}
export interface QaConfig {
    slug: string;
    base_url: string;
    autologin_param: string;
    personas: Record<string, Persona>;
    themes: ThemeConfig[];
    matrix: {
        fast: {
            themes: string[];
            widths: number[];
        };
        full: {
            themes: string[];
            widths: number[];
        };
    };
    checks: {
        roundtrip?: RoundtripCase[];
        parity?: ParityCase[];
        states?: StatesCase[];
        presentation?: Surface[];
        crawl?: CrawlPage[];
        release?: ReleaseConfig;
    };
}
/** A failure already filed as an open card: reported, not counted, until the card's fix lands. */
export interface KnownFailure {
    guard: string;
    match: string;
    card: string;
}
export declare function loadKnown(pluginPath: string): KnownFailure[];
export interface Escape {
    card: string;
    title: string;
    guard: string;
    added?: string;
}
export declare function loadConfig(pluginPath: string): QaConfig;
export declare function loadEscapes(pluginPath: string): Escape[];
/** Every guard id the config defines, as "<class>:<id>" ("release:pot" etc. for the static release checks). */
export declare function guardIds(cfg: QaConfig): Set<string>;
/** A ledger row whose guard no longer exists is a miss that is no longer being replayed. */
export declare function danglingGuards(cfg: QaConfig, escapes: Escape[]): Escape[];
