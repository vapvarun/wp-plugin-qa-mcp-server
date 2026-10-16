/**
 * Loads a plugin's live-check config from docs/qa/qa-config.json and its guard
 * ledger from audit/escapes.json. Plugins carry data only; every check engine
 * lives in this MCP so a fix to an engine reaches every plugin at once.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const CHECK_CLASSES = ['roundtrip', 'parity', 'states', 'presentation', 'crawl', 'release'];
export function loadKnown(pluginPath) {
    const p = join(pluginPath, 'audit', 'known-failures.json');
    if (!existsSync(p))
        return [];
    return (JSON.parse(readFileSync(p, 'utf8')).known ?? []);
}
export function loadConfig(pluginPath) {
    const p = join(pluginPath, 'docs', 'qa', 'qa-config.json');
    if (!existsSync(p))
        throw new Error(`missing ${p}`);
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    // Credentials never go in the committed config: a gitignored qa-config.local.json adds them per machine.
    const local = join(pluginPath, 'docs', 'qa', 'qa-config.local.json');
    const extra = existsSync(local) ? (JSON.parse(readFileSync(local, 'utf8')).personas ?? {}) : {};
    const personas = {};
    const merged = { ...(raw.personas ?? {}) };
    for (const [name, v] of Object.entries(extra))
        merged[name] = { ...(merged[name] ?? {}), ...v };
    for (const [name, v] of Object.entries(merged)) {
        personas[name] = {
            autologin: (v.autologin ?? v.sample_user),
            login: v.login,
            password: v.password,
        };
    }
    const themes = raw.themes ?? [];
    const all = themes.map((t) => t.slug);
    const pick = (m, dw) => ({
        themes: !m?.themes || m.themes === 'all' ? all : m.themes,
        widths: m?.widths ?? dw,
    });
    return {
        slug: raw.slug,
        base_url: (raw.base_url ?? '').replace(/\/$/, ''),
        autologin_param: raw.autologin_param ?? 'autologin',
        personas,
        themes,
        matrix: { fast: pick(raw.matrix?.fast, [1440, 390]), full: pick(raw.matrix?.full, [1440, 1024, 390]) },
        checks: raw.checks ?? {},
    };
}
export function loadEscapes(pluginPath) {
    const p = join(pluginPath, 'audit', 'escapes.json');
    if (!existsSync(p))
        return [];
    return (JSON.parse(readFileSync(p, 'utf8')).escapes ?? []);
}
/** Every guard id the config defines, as "<class>:<id>" ("release:pot" etc. for the static release checks). */
export function guardIds(cfg) {
    const ids = new Set();
    for (const cls of ['roundtrip', 'parity', 'states', 'presentation']) {
        for (const c of (cfg.checks[cls] ?? []))
            ids.add(`${cls}:${c.id}`);
    }
    for (const c of cfg.checks.crawl ?? [])
        ids.add(`crawl:${c.url}`);
    if (cfg.checks.release)
        for (const r of ['pot', 'build', 'refs'])
            ids.add(`release:${r}`);
    return ids;
}
/** A ledger row whose guard no longer exists is a miss that is no longer being replayed. */
export function danglingGuards(cfg, escapes) {
    const ids = guardIds(cfg);
    return escapes.filter((e) => !ids.has(e.guard));
}
//# sourceMappingURL=config.js.map