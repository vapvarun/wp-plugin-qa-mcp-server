/**
 * WP Plugin QA MCP Server - REST to JS Contract Checker
 *
 * Catches the "REST envelope mismatch" bug class: JS reads `data.courses` but
 * the PHP controller refactor now returns `{data: [], meta: {...}}`. Both
 * isolated tests pass; live integration silently breaks.
 *
 * Learnomy example: catalog-view.js expected `{courses, next_cursor}` but
 * Base_Controller now returns `{data, meta.cursor_next}`.
 *
 * Static-only: no live HTTP. Extract PHP response shapes from controller
 * return statements, then grep JS near route URLs for property accesses that
 * aren't in the shape.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { findPhpFiles, findJsFiles, getLineNumber, relativePath, generateTestId, dirExists, } from './shared-utils.js';
const ENVELOPE_KEYS = new Set([
    'data',
    'error',
    'message',
    'code',
    'status',
    'success',
    'errors',
    'params',
    'headers',
    'body',
]);
export function checkRestJsContract(pluginPath) {
    const startTime = Date.now();
    const issues = [];
    const seenMismatch = new Set();
    const phpFiles = findPhpFiles(pluginPath);
    const routes = collectRoutes(phpFiles, pluginPath);
    if (routes.length === 0) {
        return {
            category: 'rest-js-contract',
            issues: [],
            passed: 0,
            failed: 0,
            skipped: 1,
            duration: Date.now() - startTime,
        };
    }
    const jsDirs = [];
    const assetsJs = join(pluginPath, 'assets', 'js');
    const srcDir = join(pluginPath, 'src');
    if (dirExists(assetsJs))
        jsDirs.push(assetsJs);
    if (dirExists(srcDir))
        jsDirs.push(srcDir);
    const jsFiles = [];
    for (const d of jsDirs) {
        for (const f of findJsFiles(d))
            jsFiles.push(f);
    }
    for (const jsFile of jsFiles) {
        let js;
        try {
            js = readFileSync(jsFile, 'utf-8');
        }
        catch {
            continue;
        }
        const relJs = relativePath(jsFile, pluginPath);
        const jsLines = js.split('\n');
        for (const route of routes) {
            // If we couldn't recover any response keys from the PHP side, we have
            // no ground truth — skip rather than emit a flood of false positives
            // comparing the JS against an empty Set.
            if (route.keys.size === 0)
                continue;
            const routeMatches = findRouteReferences(js, route.route);
            if (routeMatches.length === 0)
                continue;
            for (const mIdx of routeMatches) {
                const startLine = getLineNumber(js, mIdx);
                const windowStart = Math.max(0, startLine - 5);
                const windowEnd = Math.min(jsLines.length, startLine + 50);
                const window = jsLines.slice(windowStart, windowEnd).join('\n');
                const responseVarNames = guessResponseVarNames(window);
                if (responseVarNames.size === 0)
                    continue;
                const accesses = collectPropertyAccesses(window, responseVarNames);
                for (const access of accesses) {
                    if (route.keys.has(access.prop))
                        continue;
                    if (ENVELOPE_KEYS.has(access.prop))
                        continue;
                    if (isGenericJsIdentifier(access.prop))
                        continue;
                    const accessLine = windowStart + access.relLine;
                    // Dedupe: same file + line + prop is one bug regardless of how many
                    // routes it matched against. (Route URL segments overlap — a JS
                    // access near /courses/N/lessons will also match /sections/N/lessons
                    // if both share the "lessons" tail. Report once, with the first
                    // matching route as the evidence.)
                    const dedupeKey = `${relJs}:${accessLine}:${access.prop}`;
                    if (seenMismatch.has(dedupeKey))
                        continue;
                    seenMismatch.add(dedupeKey);
                    issues.push({
                        id: generateTestId('rest-js-contract'),
                        category: 'rest-js-contract',
                        severity: 'high',
                        type: 'error',
                        title: `JS reads "${access.prop}" not in response shape`,
                        message: `${relJs}:${accessLine} accesses ${access.varName}.${access.prop} near route ${route.route}, but the PHP controller (${route.file}:${route.line}) returns keys [${Array.from(route.keys)
                            .slice(0, 8)
                            .join(', ')}]. Classic envelope-mismatch silent bug.`,
                        file: relJs,
                        line: accessLine,
                        code: 'rest-js-mismatch',
                        fix: `Either rename the PHP response key to "${access.prop}" (if the JS is the contract) or update the JS to read one of [${Array.from(route.keys)
                            .slice(0, 5)
                            .join(', ')}]. Add a JSON contract fixture so this drifts loudly next time.`,
                    });
                }
            }
        }
    }
    const errorCount = issues.filter((i) => i.type === 'error').length;
    return {
        category: 'rest-js-contract',
        issues,
        passed: Math.max(0, routes.length - errorCount),
        failed: errorCount,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
function collectRoutes(phpFiles, pluginPath) {
    const routes = [];
    for (const file of phpFiles) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        }
        catch {
            continue;
        }
        const rel = relativePath(file, pluginPath);
        const routeRe = /register_rest_route\s*\(\s*(?:[^,]+),\s*['"]([^'"]+)['"]\s*,\s*(?:\[|array\s*\()([\s\S]{0,1500}?)(?:\]|\))\s*\)\s*;/g;
        for (const m of Array.from(content.matchAll(routeRe))) {
            const route = m[1];
            const argsBody = m[2];
            const callbackName = extractCallbackName(argsBody);
            const line = getLineNumber(content, m.index ?? 0);
            if (!callbackName)
                continue;
            const keys = extractCallbackResponseKeys(content, callbackName);
            routes.push({
                route,
                callback: callbackName,
                keys,
                file: rel,
                line,
            });
        }
    }
    return routes;
}
function extractCallbackName(argsBody) {
    let m = argsBody.match(/['"]callback['"]\s*=>\s*(?:\[|array\s*\()\s*\$this\s*,\s*['"]([a-z_][a-z0-9_]*)['"]/i);
    if (m)
        return m[1];
    m = argsBody.match(/['"]callback['"]\s*=>\s*['"]([a-z_][a-z0-9_\\]*)['"]/i);
    if (m)
        return m[1];
    m = argsBody.match(/['"]callback['"]\s*=>\s*(?:\[|array\s*\()\s*['"][^'"]+['"]\s*,\s*['"]([a-z_][a-z0-9_]*)['"]/i);
    if (m)
        return m[1];
    return null;
}
function extractCallbackResponseKeys(content, callbackName) {
    const keys = new Set();
    const fnRe = new RegExp('function\\s+' + callbackName + '\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{', 'i');
    const fnMatch = content.match(fnRe);
    if (!fnMatch || fnMatch.index === undefined)
        return keys;
    const bodyStart = fnMatch.index + fnMatch[0].length - 1;
    const bodyEnd = findMatchingBrace(content, bodyStart);
    if (bodyEnd < 0)
        return keys;
    const body = content.slice(bodyStart, bodyEnd);
    const ensureRe = /rest_ensure_response\s*\(\s*(?:\[|array\s*\()([\s\S]{0,2000}?)(?:\]|\))\s*\)/g;
    for (const m of Array.from(body.matchAll(ensureRe))) {
        for (const k of extractArrayLiteralKeys(m[1]))
            keys.add(k);
    }
    const returnRe = /\breturn\s*(?:\[|array\s*\()([\s\S]{0,2000}?)(?:\]|\))\s*;/g;
    for (const m of Array.from(body.matchAll(returnRe))) {
        for (const k of extractArrayLiteralKeys(m[1]))
            keys.add(k);
    }
    const ensureVarRe = /rest_ensure_response\s*\(\s*\$([a-z_][a-z0-9_]*)\s*\)/gi;
    for (const m of Array.from(body.matchAll(ensureVarRe))) {
        const varName = m[1];
        const assignRe = new RegExp('\\$' + varName + '\\s*=\\s*(?:\\[|array\\s*\\()([\\s\\S]{0,2000}?)(?:\\]|\\))\\s*;', 'g');
        for (const am of Array.from(body.matchAll(assignRe))) {
            for (const k of extractArrayLiteralKeys(am[1]))
                keys.add(k);
        }
    }
    // Learnomy / WBcom convention: $this->single_response( [ ... ] ),
    // $this->success_response( [ ... ] ), $this->paginated_response( $items, ... )
    // The single/success wrappers inline the shape we want; paginated always
    // emits { data, meta } which are envelope wrappers.
    const helperRe = /\$this->(single_response|success_response|created_response|updated_response)\s*\(\s*(?:\[|array\s*\()([\s\S]{0,2000}?)(?:\]|\))\s*\)/g;
    for (const m of Array.from(body.matchAll(helperRe))) {
        for (const k of extractArrayLiteralKeys(m[2]))
            keys.add(k);
    }
    // paginated_response always emits the { data, meta } envelope — add those
    // so JS accessing response.data / response.meta is never flagged, and the
    // inner item keys have to come from something else (SDK clients typically
    // destructure data before indexing).
    if (/\$this->paginated_response\s*\(/.test(body)) {
        keys.add('data');
        keys.add('meta');
    }
    return keys;
}
function extractArrayLiteralKeys(body) {
    const out = [];
    const re = /['"]([a-z_][a-z0-9_]*)['"]\s*=>/gi;
    for (const m of Array.from(body.matchAll(re))) {
        out.push(m[1]);
    }
    return out;
}
function findMatchingBrace(content, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}
function findRouteReferences(js, route) {
    const hits = [];
    const tail = route.replace(/\(\?P<[^>]+>[^)]+\)/g, '*').replace(/^\//, '');
    const tailSegment = tail.split('/').filter((s) => s && !s.startsWith('(')).pop() || '';
    if (tail) {
        const re = new RegExp(escapeRegex(tail.replace(/\*/g, '.*')), 'g');
        for (const m of Array.from(js.matchAll(re))) {
            hits.push(m.index ?? 0);
        }
    }
    if (tailSegment && tailSegment.length >= 4) {
        const apiFetchRe = new RegExp(`apiFetch[^;]{0,200}['"][^'"]*${escapeRegex(tailSegment)}[^'"]*['"]`, 'g');
        for (const m of Array.from(js.matchAll(apiFetchRe))) {
            const idx = m.index ?? 0;
            if (!hits.includes(idx))
                hits.push(idx);
        }
        if (tailSegment.length >= 6) {
            const quoted = new RegExp(`['"]${escapeRegex(tailSegment)}['"]`, 'g');
            for (const m of Array.from(js.matchAll(quoted))) {
                const idx = m.index ?? 0;
                if (!hits.includes(idx))
                    hits.push(idx);
            }
        }
    }
    return hits;
}
function guessResponseVarNames(window) {
    const names = new Set();
    const thenArrow = /\.then\s*\(\s*(?:\(\s*([a-zA-Z_$][\w$]*)\s*\)|([a-zA-Z_$][\w$]*))\s*=>/g;
    for (const m of Array.from(window.matchAll(thenArrow))) {
        names.add(m[1] || m[2]);
    }
    const thenFn = /\.then\s*\(\s*function\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g;
    for (const m of Array.from(window.matchAll(thenFn))) {
        names.add(m[1]);
    }
    const awaitRe = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*await\s+(?:apiFetch|fetch)\s*\(/g;
    for (const m of Array.from(window.matchAll(awaitRe))) {
        names.add(m[1]);
    }
    for (const name of ['response', 'res', 'resp', 'result', 'data', 'payload', 'body']) {
        names.add(name);
    }
    return names;
}
function collectPropertyAccesses(window, varNames) {
    const out = [];
    for (const varName of varNames) {
        const re = new RegExp('\\b' + escapeRegex(varName) + '\\.([a-zA-Z_$][\\w$]*)', 'g');
        const seen = new Set();
        for (const m of Array.from(window.matchAll(re))) {
            const prop = m[1];
            const dedupKey = `${varName}.${prop}`;
            if (seen.has(dedupKey))
                continue;
            seen.add(dedupKey);
            const relLine = window.substring(0, m.index ?? 0).split('\n').length;
            out.push({ varName, prop, relLine });
        }
    }
    return out;
}
function isGenericJsIdentifier(prop) {
    return [
        // Array / iterable methods.
        'length',
        'map',
        'filter',
        'forEach',
        'reduce',
        'find',
        'findIndex',
        'some',
        'every',
        'includes',
        'indexOf',
        'lastIndexOf',
        'slice',
        'splice',
        'push',
        'pop',
        'shift',
        'unshift',
        'concat',
        'join',
        'split',
        'sort',
        'reverse',
        'flat',
        'flatMap',
        'entries',
        'keys',
        'values',
        // Object / string / primitive methods.
        'toString',
        'valueOf',
        'hasOwnProperty',
        'trim',
        'toLowerCase',
        'toUpperCase',
        'charAt',
        'charCodeAt',
        'replace',
        'match',
        'substring',
        'substr',
        'startsWith',
        'endsWith',
        'padStart',
        'padEnd',
        // Promise / fetch members.
        'then',
        'catch',
        'finally',
        'status',
        'statusText',
        'ok',
        'headers',
        'json',
        'text',
        'blob',
        'arrayBuffer',
        'clone',
        'redirected',
        'type',
        'bodyUsed',
        // DOM / FormData / URLSearchParams — common when the "data" var is not
        // actually the REST response.
        'append',
        'appendChild',
        'removeChild',
        'insertBefore',
        'classList',
        'className',
        'innerHTML',
        'innerText',
        'textContent',
        'dataset',
        'querySelector',
        'querySelectorAll',
        'getAttribute',
        'setAttribute',
        'hasAttribute',
        'removeAttribute',
        'addEventListener',
        'removeEventListener',
        'dispatchEvent',
        'style',
        'parentNode',
        'childNodes',
        'firstChild',
        'lastChild',
        'nextSibling',
        'previousSibling',
        'id',
        'name',
        'value',
        'checked',
        'disabled',
        'hidden',
        'files',
        'target',
        'currentTarget',
        'get',
        'set',
        'has',
        'delete',
        'size',
        'clear',
        // Envelope wrappers already considered, but harmless to repeat.
        'url',
        'constructor',
        'prototype',
        'call',
        'apply',
        'bind',
        'data',
        'error',
        'message',
        'code',
        'success',
        'errors',
    ].includes(prop);
}
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=rest-js-contract-checker.js.map