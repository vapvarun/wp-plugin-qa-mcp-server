import { gotoReady } from './browser.js';
import { pageRules, walkRules } from './rules.js';
import { wpEval } from './wp.js';
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const url = (c, path, vars = {}) => (/^https?:/.test(path) ? fill(path, vars) : c.base + fill(path, vars));
const asVars = (v) => (v && typeof v === 'object' ? v : { id: v });
async function withFixture(c, setup, teardown, fn) {
    const vars = setup ? asVars(wpEval(c.cli, setup)) : {};
    try {
        return await fn(vars);
    }
    finally {
        if (teardown)
            wpEval(c.cli, teardown, vars);
    }
}
async function submit(page, selector) {
    await Promise.all([page.waitForLoadState('networkidle'), page.click(selector)]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
}
/** One level of nesting is flattened ("settings.x") so a guard can ignore one normalised key, not a whole column. */
function flat(o) {
    const out = {};
    for (const [k, v] of Object.entries(o ?? {})) {
        if (v && typeof v === 'object' && !Array.isArray(v))
            for (const [k2, v2] of Object.entries(v))
                out[`${k}.${k2}`] = v2;
        else
            out[k] = v;
    }
    return out;
}
// An empty field the form posts back as "" is the same to the owner as a stored NULL.
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
function diff(before, after, ignore = []) {
    const [b, a] = [flat(before), flat(after)];
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    return [...keys]
        .filter((k) => !ignore.includes(k) && !ignore.includes(k.split('.')[0]) && !same(b[k], a[k]))
        .map((k) => `${k}: ${JSON.stringify(b[k])} -> ${JSON.stringify(a[k])}`);
}
/** Saving a form untouched must not change the record; flipping one checkbox must. */
export async function roundtrip(c, t) {
    const guard = `roundtrip:${t.id}`;
    return withFixture(c, t.setup, t.teardown, async (vars) => {
        const rows = [];
        const read = () => wpEval(c.cli, t.read, vars);
        const page = await c.sessions.page({ persona: t.persona, dark: false, width: 1440 });
        try {
            let before = read();
            await gotoReady(page, url(c, t.url, vars));
            await submit(page, t.submit);
            let after = read();
            const changed = diff(before, after, t.ignore);
            rows.push(changed.length
                ? { guard, status: 'fail', detail: `saving the form untouched changed the record: ${changed.join('; ')}`, where: t.url }
                : { guard, status: 'pass', detail: 'untouched save leaves the record unchanged' });
            for (const box of t.toggles ?? []) {
                before = after;
                await gotoReady(page, url(c, t.url, vars));
                const el = page.locator(`${t.form} ${box}`).first();
                if (!(await el.count())) {
                    rows.push({ guard, status: 'fail', detail: `toggle ${box} is not in the form` });
                    continue;
                }
                const was = await el.isChecked();
                // Styled switches hide the real input; force does what clicking its label does.
                await el.setChecked(!was, { force: true });
                await submit(page, t.submit);
                after = read();
                rows.push(diff(before, after, t.ignore).length
                    ? { guard, status: 'pass', detail: `${was ? 'unticking' : 'ticking'} ${box} is saved` }
                    : { guard, status: 'fail', detail: `${was ? 'unticking' : 'ticking'} ${box} and saving did not change the record`, where: t.url });
            }
        }
        finally {
            await page.close();
        }
        return rows;
    });
}
const fieldKey = (n) => (n.match(/\[([^\]]+)\](?:\[\])?$/)?.[1] ?? n).replace(/\[\]$/, '');
/** Every write arg of the REST route must be settable from every entry point that edits the same record. */
export async function parity(c, t) {
    const guard = `parity:${t.id}`;
    const probe = await c.sessions.page({ persona: t.entry_points[0].persona, dark: false, width: 1440 });
    let args = [];
    try {
        const res = await probe.request.fetch(`${c.base}/wp-json${t.rest.route}`, { method: 'OPTIONS' });
        const body = (await res.json());
        const method = t.rest.method ?? 'POST';
        args = Object.keys(body.endpoints?.find((e) => e.methods.includes(method))?.args ?? {});
    }
    finally {
        await probe.close();
    }
    if (!args.length)
        return [{ guard, status: 'fail', detail: `no ${t.rest.method ?? 'POST'} args found at ${t.rest.route}` }];
    const rows = [];
    for (const ep of t.entry_points) {
        const page = await c.sessions.page({ persona: ep.persona, dark: false, width: 1440 });
        try {
            await gotoReady(page, url(c, ep.url), ep.open);
            const names = await page.$$eval(`${ep.form} [name]`, (els) => els.map((e) => e.name));
            const have = new Set(names.map(fieldKey));
            const skip = new Set([...(t.ignore ?? []), ...(t.allow?.[ep.name] ?? [])]);
            const missing = args.filter((a) => !skip.has(a) && !have.has(a));
            rows.push(missing.length
                ? { guard, status: 'fail', detail: `${ep.name} form cannot set: ${missing.join(', ')}`, where: ep.url }
                : { guard, status: 'pass', detail: `${ep.name} form covers every ${t.rest.route} field` });
        }
        finally {
            await page.close();
        }
    }
    return rows;
}
/** A seeded state must render the way the owner expects: offered, hidden, listed, or counted. */
export async function states(c, t) {
    const guard = `states:${t.id}`;
    return withFixture(c, t.setup, t.teardown, async (vars) => {
        const page = await c.sessions.page({ persona: t.persona, dark: false, width: 1440 });
        const bad = [];
        try {
            await gotoReady(page, url(c, t.url, vars), t.open);
            for (const e of t.expect) {
                const sel = fill(e.selector, vars);
                const loc = page.locator(sel);
                const n = await loc.count();
                if (e.absent && n)
                    bad.push(`${sel} should be absent, found ${n}`);
                if (e.count !== undefined && n !== e.count)
                    bad.push(`${sel} count ${n}, expected ${e.count}`);
                if (e.min !== undefined && n < e.min)
                    bad.push(`${sel} count ${n}, expected >= ${e.min}`);
                if (e.text && !(await loc.allInnerTexts()).some((x) => x.includes(e.text)))
                    bad.push(`${sel} has no "${e.text}"`);
            }
        }
        finally {
            await page.close();
        }
        return [bad.length ? { guard, status: 'fail', detail: bad.join('; '), where: t.url } : { guard, status: 'pass', detail: `${t.expect.length} expectations hold` }];
    });
}
export async function presentation(c, s, themes, widths) {
    const guard = `presentation:${s.id}`;
    return withFixture(c, s.setup, s.teardown, async (vars) => {
        const rows = [];
        // wp-admin does not render the frontend theme, so admin surfaces run once per width.
        const combos = s.kind === 'admin' ? [{ dark: false }] : themes.flatMap((theme) => (theme.dark ? [false, true] : [false]).map((dark) => ({ theme, dark })));
        for (const { theme, dark } of combos) {
            {
                for (const width of widths) {
                    const combo = `${theme?.slug ?? 'admin'} ${dark ? 'dark' : 'light'} ${width}`;
                    let page;
                    try {
                        page = await c.sessions.page({ persona: s.persona, theme, dark, width });
                        await gotoReady(page, url(c, s.url, vars), s.open);
                        const fails = await page.evaluate(pageRules, {
                            root: s.root, kind: s.kind, dark, sidebar: theme?.sidebar, fullWidth: s.full_width, width, assertions: s.assert ?? [],
                        });
                        let evidence;
                        if (fails.length && c.artifacts) {
                            evidence = `${c.artifacts}/${s.id}-${theme?.slug ?? 'admin'}-${dark ? 'dark' : 'light'}-${width}.png`;
                            await page.screenshot({ path: evidence, fullPage: true });
                        }
                        rows.push(fails.length
                            ? { guard, status: 'fail', detail: `[${combo}] ${fails.map((f) => `${f.rule}: ${f.detail}`).join(' | ')}`, where: s.url, evidence }
                            : { guard, status: 'pass', detail: `[${combo}] clean` });
                    }
                    catch (e) {
                        rows.push({ guard, status: 'fail', detail: `[${combo}] ${e.message.split('\n')[0]}`, where: s.url });
                    }
                    finally {
                        await page?.close();
                    }
                }
            }
        }
        return rows;
    });
}
export const CRAWL_LINK_CAP = 60;
/** The same-origin links a crawl follows, capped; `total` says how many qualified so the cap is visible. */
export function crawlLinks(links, origin, cap = CRAWL_LINK_CAP) {
    const own = links.filter((h) => h.startsWith(origin) && !h.includes('logout') && !h.includes('action=delete') && !h.includes('_wpnonce'));
    return { check: own.slice(0, cap), total: own.length };
}
/**
 * Collect everything a page reports as broken while it loads: uncaught JS
 * errors, console errors, and same-origin requests that fail or answer 4xx/5xx.
 */
export function watchPage(page, origin) {
    const seen = { js: [], requests: [] };
    const own = (u) => u.startsWith(origin);
    page.on('pageerror', (e) => seen.js.push(String(e.message).split('\n')[0]));
    page.on('console', (m) => {
        // The browser logs a generic line for each failed resource; the response listener names the URL.
        if (m.type() === 'error' && !/^Failed to load resource/.test(m.text()))
            seen.js.push(`console: ${m.text().split('\n')[0]}`);
    });
    page.on('requestfailed', (r) => {
        const why = r.failure()?.errorText ?? 'failed';
        // An aborted request is the page navigating away or cancelling its own fetch.
        if (own(r.url()) && !/ERR_ABORTED/.test(why))
            seen.requests.push(`${r.url()} -> ${why}`);
    });
    page.on('response', (r) => {
        // The page's own status is reported by the caller.
        if (own(r.url()) && r.status() >= 400 && !r.request().isNavigationRequest())
            seen.requests.push(`${r.url()} -> ${r.status()}`);
    });
    return seen;
}
/** Fresh-install walk: every page answers, shows no PHP error, no empty list shell, no JS/console error, no failed same-origin request, and no broken plugin link. */
export async function crawl(c, p) {
    const guard = `crawl:${p.url}`;
    const page = await c.sessions.page({ persona: p.persona, dark: false, width: 1440 });
    const origin = new URL(c.base).origin;
    const seen = watchPage(page, origin);
    const bad = [];
    let walked = { check: [], total: 0 };
    try {
        const status = await gotoReady(page, url(c, p.url), p.open);
        if (status >= 400)
            bad.push(`HTTP ${status}`);
        bad.push(...(await page.evaluate(walkRules, p.root ?? 'body')).map((f) => `${f.rule}: ${f.detail}`));
        const scope = p.root ?? '#wpbody-content, main, body';
        // The WordPress toolbar is core chrome; its links are not the plugin's.
        const links = await page.$$eval(`${scope} a[href]`, (as) => [
            // getAttribute, not .href: an <a> inside an SVG has an SVGAnimatedString href that serialises to undefined.
            ...new Set(as.filter((a) => !a.closest('#wpadminbar')).map((a) => new URL(a.getAttribute('href') ?? '', document.baseURI).href)),
        ]);
        walked = crawlLinks(links, origin);
        for (const href of walked.check) {
            const r = await page.request.get(href, { maxRedirects: 5 }).catch(() => null);
            if (!r || r.status() >= 400)
                bad.push(`link ${href} -> ${r ? r.status() : 'no response'}`);
        }
        if (seen.js.length)
            bad.push(`JS errors: ${seen.js.slice(0, 3).join('; ')}`);
        if (seen.requests.length)
            bad.push(`failed requests: ${[...new Set(seen.requests)].slice(0, 5).join('; ')}`);
    }
    finally {
        await page.close();
    }
    const capped = walked.total > walked.check.length;
    const note = capped ? `capped: checked ${walked.check.length} of ${walked.total} same-origin links` : undefined;
    return [bad.length
            ? { guard, status: 'fail', detail: bad.join(' | '), where: p.url, note }
            : { guard, status: 'pass', detail: `page clean, ${walked.check.length} links resolve`, note }];
}
//# sourceMappingURL=checks.js.map