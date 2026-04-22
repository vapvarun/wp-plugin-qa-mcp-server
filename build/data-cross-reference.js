/**
 * WP Plugin QA MCP Server - Data Cross-Reference
 *
 * Catalogs every data store (post_meta, user_meta, term_meta, option, transient,
 * custom DB table/column) a plugin touches, and records every writer + reader.
 * The critical class of bug this catches is "stale-read": a reader with zero
 * matching writers - the exact bug where UI always renders the default/zero
 * value because the real data lives elsewhere.
 */
import { findPhpFiles, safeReadFile, getLineNumber, relativePath } from './shared-utils.js';
import { scanPlugin } from './scanner.js';
// --- Constants ----------------------------------------------------
// Core-managed keys WP itself writes to / reads from. Skipped when the plugin
// has zero in-plugin writers AND zero readers - noise filter.
const CORE_MANAGED_KEYS = new Set([
    '_edit_lock',
    '_edit_last',
    '_thumbnail_id',
    '_wp_page_template',
    '_wp_attached_file',
    '_wp_attachment_metadata',
    '_wp_trash_meta_status',
    '_wp_trash_meta_time',
    '_menu_item_type',
    '_menu_item_menu_item_parent',
    '_menu_item_object_id',
    '_menu_item_object',
    '_menu_item_target',
    '_menu_item_classes',
    '_menu_item_xfn',
    '_menu_item_url',
]);
// Helper to build a meta-style pattern (object, user, term, post) with the
// first arg being a $var (post/user/term id).
const metaPat = (verb) => new RegExp(verb + String.raw `\s*\(\s*\$?\w+\s*,\s*['"]([^'"]+)['"]`, 'g');
// Helper for get_option / set_transient style where the key is the first arg.
const optPat = (verb) => new RegExp(verb + String.raw `\s*\(\s*['"]([^'"]+)['"]`, 'g');
const META_PATTERNS = [
    { type: 'post_meta', read: metaPat('get_post_meta'), write: metaPat('(?:update_post_meta|add_post_meta)'), del: metaPat('delete_post_meta') },
    { type: 'user_meta', read: metaPat('get_user_meta'), write: metaPat('(?:update_user_meta|add_user_meta)'), del: metaPat('delete_user_meta') },
    { type: 'term_meta', read: metaPat('get_term_meta'), write: metaPat('(?:update_term_meta|add_term_meta)'), del: metaPat('delete_term_meta') },
    { type: 'option', read: optPat('get_option'), write: optPat('(?:update_option|add_option)'), del: optPat('delete_option') },
    { type: 'transient', read: optPat('get_(?:site_)?transient'), write: optPat('set_(?:site_)?transient'), del: optPat('delete_(?:site_)?transient') },
];
function newAccumulator() {
    return { readers: new Map(), writers: new Map(), deleters: new Map() };
}
function addRef(map, key, ref) {
    const list = map.get(key);
    if (!list) {
        map.set(key, [ref]);
        return;
    }
    if (list.some((r) => r.file === ref.file && r.line === ref.line))
        return;
    list.push(ref);
}
function snippetAround(content, index, radius = 60) {
    const start = Math.max(0, index - radius);
    const end = Math.min(content.length, index + radius);
    return content.substring(start, end).replace(/\s+/g, ' ').trim();
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// --- Scanner: post/user/term meta, options, transients -----------
function collectMatches(content, rel, pattern, role, target) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        const key = match[1];
        if (!key)
            continue;
        const ref = {
            file: rel,
            line: getLineNumber(content, match.index),
            snippet: snippetAround(content, match.index),
            role,
        };
        addRef(target, key, ref);
    }
}
function scanMetaLikeStores(contentsByFile, pluginPath) {
    const result = new Map();
    for (const p of META_PATTERNS)
        result.set(p.type, newAccumulator());
    for (const [file, content] of contentsByFile) {
        const rel = relativePath(file, pluginPath);
        for (const pattern of META_PATTERNS) {
            const acc = result.get(pattern.type);
            if (!acc)
                continue;
            collectMatches(content, rel, pattern.read, 'read', acc.readers);
            collectMatches(content, rel, pattern.write, 'write', acc.writers);
            collectMatches(content, rel, pattern.del, 'delete', acc.deleters);
        }
    }
    return result;
}
// From a CREATE TABLE body, pick column names. Skip KEY/INDEX/PRIMARY lines.
function parseColumnNames(body) {
    const cols = [];
    const lines = body.split(/,(?![^()]*\))/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line)
            continue;
        if (/^(?:PRIMARY\s+KEY|UNIQUE\s+KEY|KEY|INDEX|FULLTEXT|CONSTRAINT|FOREIGN\s+KEY)\b/i.test(line))
            continue;
        const colMatch = line.match(/^[`"']?(\w+)[`"']?\s+/);
        if (colMatch && colMatch[1] && !/^(?:if|not|exists)$/i.test(colMatch[1])) {
            cols.push(colMatch[1]);
        }
    }
    return cols;
}
// Parse CREATE TABLE bodies to extract column lists. Falls back to
// table-level only (empty columns) when parsing fails.
function extractTableSchemas(contentsByFile, knownSuffixes) {
    const schemas = new Map();
    for (const suffix of knownSuffixes) {
        if (!schemas.has(suffix))
            schemas.set(suffix, new Set());
    }
    const createPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?\{?\$(?:wpdb->prefix|table_prefix|prefix)\}?(\w+)[`'"]?\s*\(([^;]+?)\)\s*(?:[a-z_][\w=\s]*)?;/gis;
    for (const [, content] of contentsByFile) {
        createPattern.lastIndex = 0;
        let match;
        while ((match = createPattern.exec(content)) !== null) {
            const suffix = match[1];
            const body = match[2];
            if (!suffix || !body)
                continue;
            const cols = schemas.get(suffix) ?? new Set();
            schemas.set(suffix, cols);
            parseColumnNames(body).forEach((c) => cols.add(c));
        }
    }
    return Array.from(schemas.entries()).map(([suffix, cols]) => ({
        suffix,
        columns: Array.from(cols),
    }));
}
// Given ~800 chars around a table reference, decide read/write/delete and
// extract the specific columns touched when possible.
function classifyDbAccess(context, schemaColumns) {
    const colsReferenced = new Set();
    if (/\bdelete\s+from\b/i.test(context) || /\$wpdb->delete\s*\(/.test(context)) {
        for (const col of schemaColumns) {
            const pat = new RegExp(String.raw `\b` + escapeRegExp(col) + String.raw `\b\s*(?:=|<>|!=|<|>|like|in\s*\()`, 'i');
            if (pat.test(context))
                colsReferenced.add(col);
        }
        return { role: 'delete', columns: Array.from(colsReferenced) };
    }
    if (/\binsert\s+into\b/i.test(context) || /\$wpdb->insert\s*\(/.test(context) || /\$wpdb->replace\s*\(/.test(context)) {
        const insertMatch = context.match(/insert\s+into\s+[^(]+\(([^)]+)\)/i);
        if (insertMatch && insertMatch[1]) {
            for (const raw of insertMatch[1].split(',')) {
                const name = raw.trim().replace(/[`"']/g, '');
                if (name && schemaColumns.includes(name))
                    colsReferenced.add(name);
            }
        }
        const wpdbArr = context.match(/\$wpdb->(?:insert|replace)\s*\([^,]+,\s*(?:array\s*\(|\[)([^\]\)]+)/i);
        if (wpdbArr && wpdbArr[1]) {
            for (const col of schemaColumns) {
                const pat = new RegExp(String.raw `['"]` + escapeRegExp(col) + String.raw `['"]\s*=>`);
                if (pat.test(wpdbArr[1]))
                    colsReferenced.add(col);
            }
        }
        return { role: 'write', columns: Array.from(colsReferenced) };
    }
    if (/\bupdate\s+[^;]+set\b/i.test(context) || /\$wpdb->update\s*\(/.test(context)) {
        const setMatch = context.match(/\bset\b([^;]+?)(?:\bwhere\b|$)/i);
        if (setMatch && setMatch[1]) {
            for (const col of schemaColumns) {
                const pat = new RegExp(String.raw `\b` + escapeRegExp(col) + String.raw `\b\s*=`, 'i');
                if (pat.test(setMatch[1]))
                    colsReferenced.add(col);
            }
        }
        const wpdbUpdate = context.match(/\$wpdb->update\s*\([^,]+,\s*(?:array\s*\(|\[)([^\]\)]+)/i);
        if (wpdbUpdate && wpdbUpdate[1]) {
            for (const col of schemaColumns) {
                const pat = new RegExp(String.raw `['"]` + escapeRegExp(col) + String.raw `['"]\s*=>`);
                if (pat.test(wpdbUpdate[1]))
                    colsReferenced.add(col);
            }
        }
        return { role: 'write', columns: Array.from(colsReferenced) };
    }
    if (/\bselect\b/i.test(context)) {
        const selectMatch = context.match(/select\s+(.+?)\s+from\b/is);
        if (selectMatch && selectMatch[1]) {
            const colList = selectMatch[1];
            if (!/^\s*\*/.test(colList)) {
                for (const col of schemaColumns) {
                    const pat = new RegExp(String.raw `\b` + escapeRegExp(col) + String.raw `\b`, 'i');
                    if (pat.test(colList))
                        colsReferenced.add(col);
                }
            }
            else {
                schemaColumns.forEach((c) => colsReferenced.add(c));
            }
        }
        const whereMatch = context.match(/\bwhere\b([^;]+?)(?:\border\b|\bgroup\b|\blimit\b|$)/i);
        if (whereMatch && whereMatch[1]) {
            for (const col of schemaColumns) {
                const pat = new RegExp(String.raw `\b` + escapeRegExp(col) + String.raw `\b`, 'i');
                if (pat.test(whereMatch[1]))
                    colsReferenced.add(col);
            }
        }
        return { role: 'read', columns: Array.from(colsReferenced) };
    }
    return { role: 'read', columns: [] };
}
function scanDbColumnStores(contentsByFile, pluginPath, schemas) {
    const acc = newAccumulator();
    if (schemas.length === 0)
        return acc;
    for (const schema of schemas) {
        const suffix = schema.suffix;
        const tableRefPattern = new RegExp(String.raw `(?:\$wpdb->prefix\s*\.\s*['"]` +
            escapeRegExp(suffix) +
            String.raw `['"]|\{\$wpdb->prefix\}` +
            escapeRegExp(suffix) +
            String.raw `\b)`, 'g');
        for (const [file, content] of contentsByFile) {
            const rel = relativePath(file, pluginPath);
            tableRefPattern.lastIndex = 0;
            let match;
            while ((match = tableRefPattern.exec(content)) !== null) {
                const idx = match.index;
                const contextStart = Math.max(0, idx - 400);
                const contextEnd = Math.min(content.length, idx + 400);
                const context = content.substring(contextStart, contextEnd);
                const classification = classifyDbAccess(context, schema.columns);
                const ref = {
                    file: rel,
                    line: getLineNumber(content, idx),
                    snippet: snippetAround(content, idx),
                    role: classification.role,
                };
                const tableKey = `${suffix}.*`;
                if (classification.role === 'write')
                    addRef(acc.writers, tableKey, ref);
                else if (classification.role === 'delete')
                    addRef(acc.deleters, tableKey, ref);
                else
                    addRef(acc.readers, tableKey, ref);
                for (const col of classification.columns) {
                    const colKey = `${suffix}.${col}`;
                    const colRef = { ...ref };
                    if (classification.role === 'write')
                        addRef(acc.writers, colKey, colRef);
                    else if (classification.role === 'delete')
                        addRef(acc.deleters, colKey, colRef);
                    else
                        addRef(acc.readers, colKey, colRef);
                }
            }
        }
        // Ensure table-level entry exists even if unreferenced
        const tableKey = `${suffix}.*`;
        if (!acc.readers.has(tableKey))
            acc.readers.set(tableKey, []);
        if (!acc.writers.has(tableKey))
            acc.writers.set(tableKey, []);
    }
    return acc;
}
// --- Assembly ----------------------------------------------------
function assembleStoreEntries(type, acc) {
    const keys = new Set([
        ...acc.readers.keys(),
        ...acc.writers.keys(),
        ...acc.deleters.keys(),
    ]);
    const entries = [];
    for (const key of keys) {
        const readers = acc.readers.get(key) ?? [];
        const writers = acc.writers.get(key) ?? [];
        const deleters = acc.deleters.get(key) ?? [];
        if (CORE_MANAGED_KEYS.has(key) &&
            readers.length === 0 &&
            writers.length === 0 &&
            deleters.length === 0) {
            continue;
        }
        // Writers conceptually includes add/update AND delete (delete is also a mutation).
        const effectiveWriters = [...writers, ...deleters];
        const entry = {
            type,
            key,
            writers: effectiveWriters,
            readers,
            verdict: 'healthy',
            severity: 'info',
        };
        if (effectiveWriters.length === 0 && readers.length === 0) {
            entry.verdict = 'orphan';
            entry.severity = 'warning';
            entry.hint = 'Store declared but neither read nor written in plugin code.';
        }
        else if (effectiveWriters.length >= 1 && readers.length === 0) {
            entry.verdict = 'stale-write';
            entry.severity = 'warning';
            const w = effectiveWriters[0];
            entry.hint = `Writer at ${w.file}:${w.line} stores data nothing in the plugin ever reads - wasted I/O or dead code path.`;
        }
        else if (effectiveWriters.length === 0 && readers.length >= 1) {
            entry.verdict = 'stale-read';
            entry.severity = 'critical';
            const r = readers[0];
            entry.hint = `Reader at ${r.file}:${r.line} expects data the plugin never writes - UI will always render the default/zero value. Classic "meta key nothing writes to" bug.`;
        }
        else {
            entry.verdict = 'healthy';
            entry.severity = 'info';
        }
        entries.push(entry);
    }
    return entries;
}
// --- Public entry point ------------------------------------------
export function crossReferenceData(opts) {
    const { pluginPath } = opts;
    const manifest = opts.scanManifestCache ?? scanPlugin(pluginPath);
    const phpFiles = findPhpFiles(pluginPath);
    const contentsByFile = new Map();
    for (const file of phpFiles) {
        const c = safeReadFile(file);
        if (c)
            contentsByFile.set(file, c);
    }
    const metaAccumulators = scanMetaLikeStores(contentsByFile, pluginPath);
    const knownSuffixes = new Set(manifest.features.dbTables.map((t) => t.tableSuffix));
    const schemas = extractTableSchemas(contentsByFile, knownSuffixes);
    const dbAcc = scanDbColumnStores(contentsByFile, pluginPath, schemas);
    const allEntries = [];
    for (const [type, acc] of metaAccumulators) {
        allEntries.push(...assembleStoreEntries(type, acc));
    }
    allEntries.push(...assembleStoreEntries('db_column', dbAcc));
    const verdictRank = {
        'stale-read': 0,
        orphan: 1,
        'stale-write': 2,
        healthy: 3,
    };
    allEntries.sort((a, b) => {
        const v = verdictRank[a.verdict] - verdictRank[b.verdict];
        if (v !== 0)
            return v;
        if (a.type !== b.type)
            return a.type.localeCompare(b.type);
        return a.key.localeCompare(b.key);
    });
    const writersWithoutReaders = allEntries.filter((e) => e.verdict === 'stale-write').length;
    const readersWithoutWriters = allEntries.filter((e) => e.verdict === 'stale-read').length;
    const sharedStores = allEntries.filter((e) => e.verdict === 'healthy').length;
    return {
        summary: {
            totalStores: allEntries.length,
            writersWithoutReaders,
            readersWithoutWriters,
            sharedStores,
            timestamp: new Date().toISOString(),
            notes: [
                'JS scan: not yet implemented (PHP only in this pass).',
                'DB column resolution falls back to table-level when SELECT uses * or SQL is too dynamic.',
            ],
        },
        stores: allEntries,
    };
}
//# sourceMappingURL=data-cross-reference.js.map