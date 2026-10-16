/**
 * wppqa_run_checks: run every live check a plugin configures, then hold the
 * result against its guard ledger. Fast and full modes differ only in the
 * theme × width matrix; every check runs in both, so every past escape is
 * replayed on every run.
 */
import { mkdirSync } from 'node:fs';
import { CHECK_CLASSES, danglingGuards, loadConfig, loadEscapes, loadKnown } from './config.js';
import { installThemeSwitch, launch, removeThemeSwitch, Sessions } from './browser.js';
import { crawl, parity, presentation, roundtrip, states } from './checks.js';
import { checkBuild, checkPot, checkRefs } from './release.js';
export async function runChecks(o) {
    const cfg = loadConfig(o.pluginPath);
    const escapes = loadEscapes(o.pluginPath);
    const mode = o.mode ?? 'fast';
    const want = (cls, id) => !o.only?.length ||
        o.only.includes(cls) ||
        (id !== undefined ? o.only.includes(`${cls}:${id}`) : o.only.some((x) => x.startsWith(`${cls}:`)));
    const rows = [];
    const guard = async (g, fn) => {
        try {
            rows.push(...(await fn()));
        }
        catch (e) {
            rows.push({ guard: g, status: 'fail', detail: `check could not run: ${e.message.split('\n')[0]}` });
        }
    };
    const r = cfg.checks.release;
    if (r && want('release')) {
        rows.push(checkPot(o.pluginPath, r, cfg.slug), checkBuild(o.pluginPath, r), checkRefs(o.pluginPath, r));
    }
    const live = CHECK_CLASSES.filter((c) => c !== 'release').some((c) => want(c) && cfg.checks[c]?.length);
    if (live) {
        if (o.artifactsDir)
            mkdirSync(o.artifactsDir, { recursive: true });
        const browser = await launch();
        installThemeSwitch(o.wp, cfg.themes);
        const sessions = new Sessions(browser, cfg);
        const ctx = { cfg, cli: o.wp, sessions, base: cfg.base_url, artifacts: o.artifactsDir };
        try {
            for (const t of cfg.checks.roundtrip ?? [])
                if (want('roundtrip', t.id))
                    await guard(`roundtrip:${t.id}`, () => roundtrip(ctx, t));
            for (const t of cfg.checks.parity ?? [])
                if (want('parity', t.id))
                    await guard(`parity:${t.id}`, () => parity(ctx, t));
            for (const t of cfg.checks.states ?? [])
                if (want('states', t.id))
                    await guard(`states:${t.id}`, () => states(ctx, t));
            const m = cfg.matrix[mode];
            const themes = cfg.themes.filter((t) => m.themes.includes(t.slug));
            for (const s of cfg.checks.presentation ?? []) {
                if (!want('presentation', s.id))
                    continue;
                const pinned = s.themes ? cfg.themes.filter((t) => s.themes.includes(t.slug)) : themes;
                await guard(`presentation:${s.id}`, () => presentation(ctx, s, pinned, m.widths));
            }
            if (cfg.checks.crawl?.length && want('crawl')) {
                const freshCfg = o.freshSiteUrl ? { ...cfg, base_url: o.freshSiteUrl.replace(/\/$/, '') } : cfg;
                const fresh = o.freshSiteUrl ? new Sessions(browser, freshCfg) : sessions;
                const fctx = { ...ctx, cfg: freshCfg, base: freshCfg.base_url, sessions: fresh };
                try {
                    for (const p of cfg.checks.crawl)
                        if (want('crawl', p.url))
                            await guard(`crawl:${p.url}`, () => crawl(fctx, p));
                }
                finally {
                    if (fresh !== sessions)
                        await fresh.close();
                }
            }
        }
        finally {
            await sessions.close();
            await browser.close();
            removeThemeSwitch(o.wp);
        }
    }
    const { known: knownRows, stale: staleKnown } = applyKnown(rows, loadKnown(o.pluginPath));
    const dangling = danglingGuards(cfg, escapes).map((e) => `${e.card} -> ${e.guard}`);
    const ledgered = new Set(escapes.map((e) => e.guard));
    const unguarded = [...new Set(rows.filter((x) => x.status === 'fail' && !ledgered.has(x.guard)).map((x) => x.guard))];
    const summary = { pass: 0, fail: 0, skip: 0 };
    for (const x of rows)
        summary[x.status]++;
    // A gate that ran nothing must not read as green.
    if (!rows.length) {
        rows.push({ guard: 'run', status: 'fail', detail: `no checks matched ${o.only?.join(',') || 'the config'}` });
        summary.fail++;
    }
    return { ok: summary.fail === 0 && dangling.length === 0, mode, summary, rows, dangling, unguarded_failures: unguarded, known: knownRows, stale_known: staleKnown };
}
/**
 * Known failures stay visible but do not fail the gate; each one names its open card.
 * A row is excused only when every finding in it is filed, so a new finding in the same row still fails.
 */
export function applyKnown(rows, known) {
    const hit = new Set();
    const excused = [];
    for (const r of rows) {
        if (r.status !== 'fail')
            continue;
        const parts = r.detail.replace(/^\[[^\]]*\] /, '').split(' | ');
        const ks = parts.map((part) => known.findIndex((x) => x.guard === r.guard && part.includes(x.match)));
        if (ks.some((k) => k < 0))
            continue;
        ks.forEach((k) => hit.add(k));
        const cards = [...new Set(ks.map((k) => known[k].card))].join(', ');
        r.status = 'skip';
        r.detail = `known (card ${cards}): ${r.detail}`;
        excused.push(`${r.guard} -> card ${cards}`);
    }
    const ran = new Set(rows.map((r) => r.guard));
    const stale = known.filter((x, i) => ran.has(x.guard) && !hit.has(i)).map((x) => `${x.guard} "${x.match}" (card ${x.card})`);
    return { known: [...new Set(excused)], stale };
}
export function formatLedger(l) {
    const lines = [
        `${l.ok ? 'PASS' : 'FAIL'} wppqa_run_checks (${l.mode}): ${l.summary.pass} pass, ${l.summary.fail} fail, ${l.summary.skip} skip`,
    ];
    for (const r of l.rows.filter((x) => x.status === 'fail')) {
        lines.push(`  x ${r.guard} ${r.detail}${r.where ? ` @ ${r.where}` : ''}${r.evidence ? ` [${r.evidence}]` : ''}`);
    }
    if (l.dangling.length)
        lines.push(`Dangling guards in audit/escapes.json (escape no longer replayed): ${l.dangling.join(', ')}`);
    if (l.known.length)
        lines.push(`Known, tracked on open cards (not failing the gate): ${l.known.join(', ')}`);
    if (l.stale_known.length)
        lines.push(`Known failures that no longer occur; remove them from audit/known-failures.json: ${l.stale_known.join(', ')}`);
    if (l.unguarded_failures.length)
        lines.push(`New failures with no escapes.json row yet: ${l.unguarded_failures.join(', ')}`);
    return lines.join('\n');
}
//# sourceMappingURL=run.js.map