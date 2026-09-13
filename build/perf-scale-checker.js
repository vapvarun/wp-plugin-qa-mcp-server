/**
 * WP Plugin QA MCP Server - Performance / Big-Site Scale Checker
 *
 * Deterministic gate for the portfolio "big-site readiness" bar: a list/table/
 * data method must work at 2000+ rows on day one. Static analysis over the
 * plugin's PHP: custom-table index coverage, unbounded reads, COUNT misuse, and
 * N+1 queries inside loops.
 *
 * Site-type-agnostic: it keys off CREATE TABLE definitions and $wpdb usage the
 * plugin actually contains. A plugin/theme with no custom tables and no direct
 * SQL degrades to `skipped` - absence of the surface is not a defect.
 *
 * ponytail: regex SQL parser, not a full AST. Precision-over-recall - only
 * tables it found a CREATE TABLE for are index-checked, and ambiguous SQL is
 * skipped rather than guessed. Upgrade path: emit SQL/CREATE-TABLE/loop facts
 * from php-ast/extract-graph.php (roadmap S0a) and consume them here.
 */
import { generateTestId, findPhpFiles, safeReadFile, getLineNumber, relativePath } from './shared-utils.js';
const CATEGORY = 'performance-scale';
/** Strip WP-prefix tokens so `{$wpdb->prefix}foo`, `$wpdb->prefix . 'foo'` and
 *  a bare `wp_foo` all normalize to the same suffix. */
function normalizeTable(raw) {
    let t = raw.trim().replace(/[`'"();]/g, '');
    t = t.replace(/\{?\$wpdb->(?:prefix|base_prefix)\}?/g, '');
    t = t.replace(/\s*\.\s*/g, ''); // concatenation dots
    t = t.replace(/^\$\w+/, ''); // leading $table var remnant
    t = t.replace(/^wp_/, ''); // default prefix if hardcoded
    return t.trim().toLowerCase();
}
/** Columns referenced in a comma/AND-separated clause fragment. */
function colsFrom(fragment) {
    const cols = [];
    const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|!=|<>|<=|>=|<|>|\bIN\b|\bLIKE\b|\bIS\b|\bBETWEEN\b)/gi;
    for (const m of fragment.matchAll(re)) {
        const c = m[1].toLowerCase();
        if (c !== 'and' && c !== 'or')
            cols.push(c);
    }
    return cols;
}
function parseCreateTables(content, file) {
    const out = [];
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/gi;
    for (const m of content.matchAll(re)) {
        const start = (m.index ?? 0) + m[0].length;
        // Brace-match the paren body.
        let depth = 1, i = start;
        for (; i < content.length && depth > 0; i++) {
            if (content[i] === '(')
                depth++;
            else if (content[i] === ')')
                depth--;
        }
        const body = content.slice(start, i - 1);
        const suffix = normalizeTable(m[1]);
        if (!suffix)
            continue;
        const columns = new Set();
        const indexedFirstCols = new Set();
        for (const rawLine of body.split(',\n').join(',').split(',')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            const keyMatch = line.match(/^(?:PRIMARY\s+KEY|UNIQUE(?:\s+KEY)?|KEY|INDEX|FULLTEXT(?:\s+KEY)?)\b[^(]*\(\s*`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i);
            if (keyMatch) {
                indexedFirstCols.add(keyMatch[1].toLowerCase());
                continue;
            }
            const colMatch = line.match(/^`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+\w/);
            if (colMatch)
                columns.add(colMatch[1].toLowerCase());
        }
        out.push({ suffix, columns, indexedFirstCols, file, line: getLineNumber(content, m.index ?? 0) });
    }
    return out;
}
/** Find SQL embedded in $wpdb calls / query strings. */
function parseQueries(content, file, knownSuffixes) {
    const out = [];
    // Match a $wpdb->method( ... ) call and grab its first string-ish argument span.
    const callRe = /\$wpdb->(get_results|get_col|get_row|get_var|query|prepare)\s*\(/gi;
    for (const m of content.matchAll(callRe)) {
        const method = m[1].toLowerCase();
        const argStart = (m.index ?? 0) + m[0].length;
        let depth = 1, i = argStart;
        for (; i < content.length && depth > 0; i++) {
            if (content[i] === '(')
                depth++;
            else if (content[i] === ')')
                depth--;
        }
        const sql = content.slice(argStart, i - 1);
        const upper = sql.toUpperCase();
        if (!/\bSELECT\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b/.test(upper))
            continue;
        const kind = upper.includes('SELECT') ? 'select'
            : upper.includes('UPDATE') ? 'update'
                : upper.includes('DELETE') ? 'delete'
                    : upper.includes('INSERT') ? 'insert' : 'other';
        // Resolve target table from FROM / JOIN / UPDATE / INTO.
        let suffix = '';
        const tblMatch = sql.match(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([^\s(]+)/i);
        if (tblMatch) {
            const n = normalizeTable(tblMatch[1]);
            if (knownSuffixes.has(n))
                suffix = n;
        }
        const whereCols = new Set();
        const orderCols = new Set();
        const joinCols = new Set();
        const whereMatch = sql.match(/\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i);
        if (whereMatch)
            for (const c of colsFrom(whereMatch[1]))
                whereCols.add(c);
        const orderMatch = sql.match(/\bORDER\s+BY\b([\s\S]*?)(?:\bLIMIT\b|$)/i);
        if (orderMatch)
            for (const c of orderMatch[1].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
                const cc = c[1].toLowerCase();
                if (cc !== 'asc' && cc !== 'desc')
                    orderCols.add(cc);
            }
        for (const j of sql.matchAll(/\bON\b\s+[\s\S]*?([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[\s\S]*?([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
            joinCols.add(j[1].toLowerCase());
            joinCols.add(j[2].toLowerCase());
        }
        out.push({
            suffix, kind,
            isCount: /\bCOUNT\s*\(/i.test(sql),
            multiRow: method === 'get_results' || method === 'get_col',
            whereCols, orderCols, joinCols,
            hasLimit: /\bLIMIT\b/i.test(sql),
            file, line: getLineNumber(content, m.index ?? 0),
        });
    }
    return out;
}
/** Detect a query call lexically inside a foreach/for/while body (N+1). */
function findLoopQueries(content, file) {
    const hits = [];
    const queryCall = /\$wpdb->(?:get_results|get_row|get_col|get_var|query)\s*\(|get_post_meta\s*\(|get_user_meta\s*\(|get_term_meta\s*\(|get_metadata\s*\(|new\s+WP_Query\s*\(|get_posts\s*\(/;
    const loopRe = /\b(foreach|for|while)\s*\(/g;
    for (const m of content.matchAll(loopRe)) {
        // Walk to the loop's opening brace, then brace-match the body.
        let i = (m.index ?? 0) + m[0].length;
        let paren = 1;
        for (; i < content.length && paren > 0; i++) {
            if (content[i] === '(')
                paren++;
            else if (content[i] === ')')
                paren--;
        }
        while (i < content.length && /\s/.test(content[i]))
            i++;
        if (content[i] !== '{')
            continue; // single-statement loop body: skip (rare, low risk)
        let depth = 1;
        const bodyStart = i + 1;
        i = bodyStart;
        for (; i < content.length && depth > 0; i++) {
            if (content[i] === '{')
                depth++;
            else if (content[i] === '}')
                depth--;
        }
        const body = content.slice(bodyStart, i - 1);
        const qm = body.match(queryCall);
        if (qm) {
            hits.push({
                file,
                line: getLineNumber(content, (m.index ?? 0) + (body.indexOf(qm[0]) >= 0 ? m[0].length : 0)),
                snippet: qm[0].replace(/\s*\($/, ''),
            });
        }
    }
    return hits;
}
function issue(severity, type, title, message, file, line, code, fix) {
    return { id: generateTestId(CATEGORY), category: CATEGORY, severity, type, title, message, file, line, code, fix };
}
export function checkScale(manifest) {
    const startTime = Date.now();
    const issues = [];
    const files = findPhpFiles(manifest.pluginPath);
    const schemas = [];
    const contents = [];
    for (const f of files) {
        const content = safeReadFile(f);
        if (!content)
            continue;
        contents.push({ file: f, content });
        if (/CREATE\s+TABLE/i.test(content))
            schemas.push(...parseCreateTables(content, f));
    }
    const suffixes = new Set(schemas.map(s => s.suffix));
    const schemaBySuffix = new Map(schemas.map(s => [s.suffix, s]));
    const queries = [];
    const loopHits = [];
    const countHits = [];
    const countRe = /\bcount\s*\(\s*[^)]*->(?:get_all|all|list_all|find_all|get_results|fetch_all)\s*\(/gi;
    let hasWpdb = false;
    for (const { file, content } of contents) {
        if (content.includes('$wpdb->'))
            hasWpdb = true;
        queries.push(...parseQueries(content, file, suffixes));
        loopHits.push(...findLoopQueries(content, file));
        for (const m of content.matchAll(countRe))
            countHits.push({ file, line: getLineNumber(content, m.index ?? 0) });
    }
    // Degrade: nothing to scale-check.
    if (schemas.length === 0 && !hasWpdb && loopHits.length === 0 && countHits.length === 0) {
        return { category: CATEGORY, issues, passed: 0, failed: 0, skipped: 1, duration: Date.now() - startTime };
    }
    let checks = 0;
    // 1.1 Index coverage — WHERE/ORDER BY/JOIN columns on custom tables must be indexed.
    for (const q of queries) {
        if (!q.suffix)
            continue;
        const schema = schemaBySuffix.get(q.suffix);
        if (!schema)
            continue;
        const used = new Set([...q.whereCols, ...q.orderCols, ...q.joinCols]);
        for (const col of used) {
            checks++;
            if (!schema.columns.has(col))
                continue; // not a real column of this table -> skip (alias/join noise)
            if (schema.indexedFirstCols.has(col))
                continue; // covered
            issues.push(issue('high', 'error', `Unindexed column \`${col}\` filtered/sorted on custom table \`${q.suffix}\``, `Query on \`${q.suffix}\` uses \`${col}\` in WHERE/ORDER BY/JOIN but the CREATE TABLE (${relativePath(schema.file, manifest.pluginPath)}:${schema.line}) has no index leading with it. At 2000+ rows this is a full table scan.`, relativePath(q.file, manifest.pluginPath), q.line, 'missing-index', `Add \`KEY ${col} (${col})\` to the CREATE TABLE for \`${q.suffix}\` and bump the schema version.`));
        }
    }
    // 1.2 Unbounded multi-row read on a custom table.
    for (const q of queries) {
        if (q.kind !== 'select' || q.isCount || !q.multiRow || q.hasLimit || !q.suffix)
            continue;
        checks++;
        issues.push(issue('medium', 'warning', `Unbounded read on custom table \`${q.suffix}\``, `A multi-row SELECT on \`${q.suffix}\` has no LIMIT. On a large site this loads every row into memory.`, relativePath(q.file, manifest.pluginPath), q.line, 'unbounded-read', `Add LIMIT + OFFSET pagination, or a cursor. If the set is genuinely bounded, add a comment saying so.`));
    }
    // 1.3 COUNT via count(list_all()) instead of SELECT COUNT(*).
    for (const h of countHits) {
        checks++;
        issues.push(issue('medium', 'warning', 'Counting a full result set instead of COUNT(*)', `count(...) wraps a method that fetches every row just to size it. Use a dedicated count_*() running SELECT COUNT(*).`, relativePath(h.file, manifest.pluginPath), h.line, 'count-via-listall', `Add a count method that runs SELECT COUNT(*) with the same WHERE, and call it here.`));
    }
    // 1.4 N+1 — query call inside a loop body.
    for (const h of loopHits) {
        checks++;
        issues.push(issue('high', 'warning', `Query \`${h.snippet}\` runs inside a loop (N+1)`, `A per-row query in a loop issues one DB round-trip per item. At 2000+ rows this is 2000+ queries.`, relativePath(h.file, manifest.pluginPath), h.line, 'n-plus-one', `Batch-fetch before the loop (WP_User_Query/WP_Query with include, get_metadata for many ids, or one JOIN), or add a comment accepting the cost.`));
    }
    const failed = issues.filter(i => i.type === 'error').length;
    return {
        category: CATEGORY,
        issues,
        passed: Math.max(0, checks - issues.length),
        failed,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
//# sourceMappingURL=perf-scale-checker.js.map