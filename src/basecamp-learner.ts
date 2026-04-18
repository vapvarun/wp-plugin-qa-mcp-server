/**
 * WP Plugin QA MCP Server - Basecamp Learner
 *
 * Plugin-agnostic Basecamp ledger generator with a local per-card cache.
 * Two-phase contract: first call with compact listings may return
 * { pending: true, needsFetch } WITHOUT writing; orchestrator fetches
 * missing card bodies + comments and re-invokes with fetched_full_cards /
 * fetched_comments to build plan/basecamp/ledger.md + ledger.json plus
 * a cache/ tree so subsequent runs only re-fetch what changed.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { dirExists, fileExists, safeReadFile } from './shared-utils.js';

// ─── Public Types ──────────────────────────────────────────────────

export interface CompactCard {
  id: number | string; title: string; updated_at: string;
  created_at?: string; app_url?: string;
  comments_count?: number; assignees?: string[];
}
export interface FetchedCard {
  id: number | string; title: string; created_at: string; updated_at: string;
  comments_count?: number; app_url?: string; content?: string;
  creator?: { name?: string } | string;
}
export interface FetchedComment {
  content: string; created_at?: string;
  creator?: { name?: string } | string;
}
export interface LearnFromBasecampOptions {
  pluginPath: string;
  fetchedColumns: Record<string, CompactCard[]>;
  fetchedFullCards?: Record<string, FetchedCard>;
  fetchedComments?: Record<string, FetchedComment[]>;
  projectId?: string; projectUrl?: string;
  forceFull?: boolean; writeLedger?: boolean;
}
export type LearnFromBasecampResult = BasecampLedgerReport | BasecampPendingFetch;
export interface BasecampPendingFetch {
  pending: true;
  needsFetch: { cards: string[]; comments: string[] };
  reason: string;
}
export interface BasecampLedgerReport {
  plugin: string; projectId: string; projectUrl: string; snapshotAt: string;
  columns: Record<string, { id: string; count: number; cards: CardSummary[] }>;
  insights: {
    doneWithoutRegressionFixture: string[];
    readyForTestingAging: AgingCard[];
    reopenDetection: 'not-supported-without-events-api';
    topModulesByBugCount: ModuleBucket[];
    fixCommitCoverage: { total: number; withFixSha: number; percentage: number };
    possibleDuplicates: DuplicateCandidate[];
    warnings: string[];
  };
  writtenFiles: string[];
}
export interface CardSummary {
  id: string; title: string; createdAt: string; updatedAt: string;
  creator: string; appUrl: string; commentCount: number;
  firstCommentExcerpt?: string; fixCommit?: string; fixBranch?: string;
  moduleHints: string[]; hasRegressionFixture: boolean;
}
export interface AgingCard { id: string; title: string; appUrl: string; daysInColumn: number; }
export interface ModuleBucket { module: string; count: number; sampleCards: string[]; }
export interface DuplicateCandidate {
  newCard: string; historicalCard: string; score: number; sharedKeywords: string[];
}

interface BasecampConfig {
  projectId: string; projectUrl: string;
  columns: Record<string, string>; moduleHints: Record<string, RegExp>;
}
interface CachedCard extends FetchedCard {
  comments?: FetchedComment[]; _cachedAt: string; _commentsCount: number;
}

const AGING_DAYS = 7;
const RECENT_DONE_LIMIT = 20;
const DUPLICATE_SCORE_MIN = 0.35;
const DUPLICATE_RESULT_CAP = 10;
const STOP_WORDS = new Set([
  'the', 'and', 'in', 'on', 'for', 'a', 'an', 'of', 'to', 'is',
  'are', 'was', 'were', 'be', 'by', 'with', 'from', 'this', 'that', 'it', 'not',
]);

// ─── Entry ─────────────────────────────────────────────────────────

export async function learnFromBasecamp(
  opts: LearnFromBasecampOptions,
): Promise<LearnFromBasecampResult> {
  const { pluginPath } = opts;
  if (!pluginPath || !dirExists(pluginPath)) {
    throw new Error(`learnFromBasecamp: pluginPath does not exist or is not a directory: ${pluginPath}`);
  }
  if (!opts.fetchedColumns || typeof opts.fetchedColumns !== 'object' || !Object.keys(opts.fetchedColumns).length) {
    throw new Error('wppqa_learn_from_basecamp: fetchedColumns is empty — call basecamp_list_card_ids per column and pass the result in.');
  }

  const cfg = resolveConfig(pluginPath, opts);
  const warnings: string[] = [];
  for (const name of Object.keys(opts.fetchedColumns)) {
    if (Object.keys(cfg.columns).length && !(name in cfg.columns)) {
      warnings.push(`Column "${name}" was not declared in plan/basecamp.yml — processed but its column id will be unknown.`);
    }
  }

  const writeLedger = opts.writeLedger !== false;
  const forceFull = opts.forceFull === true;
  const pluginSlug = derivePluginSlug(pluginPath);
  const regressionIndex = indexRegressionFixtures(join(pluginPath, 'plan', 'regression'));
  const cacheRoot = join(pluginPath, 'plan', 'basecamp', 'cache');
  const cardsCacheDir = join(cacheRoot, 'cards');
  const cache = loadCardCache(cardsCacheDir);
  const haveCards = new Set(Object.keys(opts.fetchedFullCards ?? {}));
  const haveComments = new Set(Object.keys(opts.fetchedComments ?? {}));

  const { needsCards, needsComments, staleCount, newCount, missingCommentsCount } =
    computeNeeds(opts.fetchedColumns, cache, haveCards, haveComments, forceFull);

  if (!forceFull && (needsCards.size + needsComments.size) > 0
      && !covered(needsCards, needsComments, haveCards, haveComments)) {
    const parts: string[] = [];
    if (staleCount) parts.push(`${staleCount} cards stale`);
    if (newCount) parts.push(`${newCount} new`);
    if (missingCommentsCount) parts.push(`${missingCommentsCount} missing comment cache`);
    return {
      pending: true,
      needsFetch: { cards: [...needsCards].sort(), comments: [...needsComments].sort() },
      reason: (parts.length ? parts.join(', ') : 'Cache incomplete')
        + ' — fetch card bodies + comments and re-call with fetched_full_cards / fetched_comments populated.',
    };
  }

  mergeIntoCache(cache, opts.fetchedFullCards, opts.fetchedComments, opts.fetchedColumns);
  const writtenFiles: string[] = [];
  if (writeLedger) writeCacheFiles(cacheRoot, cardsCacheDir, cache, opts.fetchedColumns, writtenFiles);

  const columns: BasecampLedgerReport['columns'] = {};
  const allCards: Array<{ column: string; card: CardSummary }> = [];
  for (const [colName, rawCards] of Object.entries(opts.fetchedColumns)) {
    const list = Array.isArray(rawCards) ? rawCards : [];
    const cards: CardSummary[] = [];
    for (const compact of list) {
      const summary = summarizeCard(compact, cache.get(String(compact.id)), cfg.moduleHints, regressionIndex);
      cards.push(summary);
      allCards.push({ column: colName, card: summary });
    }
    columns[colName] = { id: cfg.columns[colName] ?? '', count: cards.length, cards };
  }

  const report: BasecampLedgerReport = {
    plugin: pluginSlug, projectId: cfg.projectId, projectUrl: cfg.projectUrl,
    snapshotAt: new Date().toISOString(),
    columns, insights: computeInsights(columns, allCards, warnings), writtenFiles,
  };

  if (writeLedger) {
    const ledgerDir = join(pluginPath, 'plan', 'basecamp');
    if (!dirExists(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
    const jsonPath = join(ledgerDir, 'ledger.json');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    writtenFiles.push(jsonPath);
    const mdPath = join(ledgerDir, 'ledger.md');
    writeFileSync(mdPath, renderLedgerMarkdown(report), 'utf-8');
    writtenFiles.push(mdPath);
  }
  return report;
}

// ─── Cache / planning helpers ─────────────────────────────────────

function resolveConfig(pluginPath: string, opts: LearnFromBasecampOptions): BasecampConfig {
  const configPath = join(pluginPath, 'plan', 'basecamp.yml');
  if (fileExists(configPath)) return parseBasecampConfig(safeReadFile(configPath), configPath);
  if (!opts.projectId || !opts.projectUrl) {
    throw new Error(`wppqa_learn_from_basecamp: missing ${configPath} AND neither projectId nor projectUrl was supplied. Either create plan/basecamp.yml or pass projectId and projectUrl explicitly.`);
  }
  return { projectId: opts.projectId, projectUrl: opts.projectUrl, columns: {}, moduleHints: {} };
}

function loadCardCache(dir: string): Map<string, CachedCard> {
  const cache = new Map<string, CachedCard>();
  if (!dirExists(dir)) return cache;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return cache; }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const raw = safeReadFile(join(dir, name));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as CachedCard;
      cache.set(String(parsed?.id ?? name.slice(0, -5)), parsed);
    } catch { /* corrupt → skip */ }
  }
  return cache;
}

function computeNeeds(
  fetchedColumns: Record<string, CompactCard[]>,
  cache: Map<string, CachedCard>,
  haveCards: Set<string>, haveComments: Set<string>, forceFull: boolean,
) {
  const needsCards = new Set<string>();
  const needsComments = new Set<string>();
  let staleCount = 0, newCount = 0, missingCommentsCount = 0;
  for (const list of Object.values(fetchedColumns)) {
    for (const compact of Array.isArray(list) ? list : []) {
      const id = String(compact.id);
      const cached = cache.get(id);
      const expected = compact.comments_count ?? 0;
      if (forceFull || !cached) {
        if (!forceFull && !cached) newCount++;
        if (!haveCards.has(id)) needsCards.add(id);
        if (expected > 0 && !haveComments.has(id)) {
          needsComments.add(id);
          if (!forceFull && !cached) missingCommentsCount++;
        }
        continue;
      }
      const cTs = Date.parse(cached.updated_at || '');
      const nTs = Date.parse(compact.updated_at || '');
      const stale = !Number.isFinite(cTs) || !Number.isFinite(nTs)
        ? cached.updated_at !== compact.updated_at : cTs < nTs;
      if (stale && !haveCards.has(id)) { needsCards.add(id); staleCount++; }
      if (expected > 0) {
        const cachedCount = cached._commentsCount ?? cached.comments?.length ?? 0;
        if (cachedCount !== expected && !haveComments.has(id)) {
          needsComments.add(id); missingCommentsCount++;
        }
      }
    }
  }
  return { needsCards, needsComments, staleCount, newCount, missingCommentsCount };
}

function covered(need: Set<string>, needC: Set<string>, have: Set<string>, haveC: Set<string>): boolean {
  for (const id of need) if (!have.has(id)) return false;
  for (const id of needC) if (!haveC.has(id)) return false;
  return true;
}

function mergeIntoCache(
  cache: Map<string, CachedCard>,
  fullCards: Record<string, FetchedCard> | undefined,
  comments: Record<string, FetchedComment[]> | undefined,
  fetchedColumns: Record<string, CompactCard[]>,
): void {
  const now = new Date().toISOString();
  const compactById = new Map<string, CompactCard>();
  for (const list of Object.values(fetchedColumns)) {
    for (const c of Array.isArray(list) ? list : []) compactById.set(String(c.id), c);
  }
  if (fullCards) {
    for (const [rawId, card] of Object.entries(fullCards)) {
      const id = String(rawId);
      const prev = cache.get(id);
      const compact = compactById.get(id);
      const expected = card.comments_count ?? compact?.comments_count
        ?? prev?._commentsCount ?? prev?.comments?.length ?? 0;
      cache.set(id, {
        id: card.id ?? rawId,
        title: card.title ?? prev?.title ?? '',
        created_at: card.created_at ?? prev?.created_at ?? '',
        updated_at: card.updated_at ?? prev?.updated_at ?? '',
        comments_count: expected,
        app_url: card.app_url ?? prev?.app_url ?? compact?.app_url ?? '',
        creator: card.creator ?? prev?.creator,
        content: card.content ?? prev?.content ?? '',
        comments: prev?.comments ?? [],
        _cachedAt: now,
        _commentsCount: prev?._commentsCount ?? 0,
      });
    }
  }
  if (comments) {
    for (const [rawId, list] of Object.entries(comments)) {
      const id = String(rawId);
      const prev = cache.get(id);
      const compact = compactById.get(id);
      const arr = Array.isArray(list) ? list : [];
      cache.set(id, prev
        ? { ...prev, comments: arr, _commentsCount: arr.length, _cachedAt: now,
            comments_count: Math.max(prev.comments_count ?? 0, arr.length) }
        : {
            id, title: compact?.title ?? '',
            created_at: compact?.created_at ?? '',
            updated_at: compact?.updated_at ?? '',
            app_url: compact?.app_url ?? '',
            comments_count: arr.length, content: '', comments: arr,
            _cachedAt: now, _commentsCount: arr.length,
          });
    }
  }
  for (const [id, compact] of compactById) {
    if (cache.has(id)) continue;
    cache.set(id, {
      id: compact.id, title: compact.title,
      created_at: compact.created_at ?? '', updated_at: compact.updated_at,
      app_url: compact.app_url ?? '', comments_count: compact.comments_count ?? 0,
      content: '', comments: [], _cachedAt: now, _commentsCount: 0,
    });
  }
}

function writeCacheFiles(
  cacheRoot: string, cardsCacheDir: string,
  cache: Map<string, CachedCard>,
  fetchedColumns: Record<string, CompactCard[]>,
  writtenFiles: string[],
): void {
  if (!dirExists(cardsCacheDir)) mkdirSync(cardsCacheDir, { recursive: true });
  const known = new Set<string>();
  for (const list of Object.values(fetchedColumns)) {
    for (const c of Array.isArray(list) ? list : []) known.add(String(c.id));
  }
  for (const id of known) {
    const entry = cache.get(id);
    if (!entry) continue;
    const file = join(cardsCacheDir, `${id}.json`);
    writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf-8');
    writtenFiles.push(file);
  }
  if (!dirExists(cacheRoot)) mkdirSync(cacheRoot, { recursive: true });
  const snapshot = {
    snapshotAt: new Date().toISOString(),
    columns: Object.fromEntries(Object.entries(fetchedColumns).map(([name, list]) => [
      name, (Array.isArray(list) ? list : []).map((c) => ({ id: c.id, updated_at: c.updated_at })),
    ])),
  };
  const columnsFile = join(cacheRoot, 'columns.json');
  writeFileSync(columnsFile, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  writtenFiles.push(columnsFile);
}

// ─── YAML-lite Parser ──────────────────────────────────────────────

function parseBasecampConfig(source: string, configPath: string): BasecampConfig {
  let projectId = '', projectUrl = '';
  const columns: Record<string, string> = {};
  const moduleHintsRaw: Record<string, string> = {};
  let section: 'root' | 'columns' | 'module_hints' = 'root';
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripHashComment(rawLine.replace(/\s+$/u, ''));
    if (!line.trim().length) continue;
    const indent = (line.match(/^(\s*)/)?.[1].length) ?? 0;
    if (indent === 0) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (key === 'columns') { section = 'columns'; continue; }
      if (key === 'module_hints') { section = 'module_hints'; continue; }
      section = 'root';
      const value = unquote(m[2].trim());
      if (key === 'project_id') projectId = value;
      else if (key === 'project_url') projectUrl = value;
    } else {
      const m = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const value = unquote(m[2].trim());
      if (!value.length) continue;
      if (section === 'columns') columns[m[1]] = value;
      else if (section === 'module_hints') moduleHintsRaw[m[1]] = value;
    }
  }
  if (!projectId) throw new Error(`learnFromBasecamp: ${configPath} is missing required \`project_id\`.`);
  if (!Object.keys(columns).length) throw new Error(`learnFromBasecamp: ${configPath} is missing any \`columns:\` entries.`);
  const moduleHints: Record<string, RegExp> = {};
  for (const [label, pattern] of Object.entries(moduleHintsRaw)) {
    try { moduleHints[label] = new RegExp(pattern, 'i'); }
    catch (err) {
      throw new Error(`learnFromBasecamp: invalid regex for module_hints.${label} in ${configPath}: ${(err as Error).message}`);
    }
  }
  return { projectId, projectUrl: projectUrl || `https://3.basecamp.com/buckets/${projectId}`, columns, moduleHints };
}

function stripHashComment(line: string): string {
  let inSingle = false, inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\'' && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}
function unquote(v: string): string {
  if (v.length >= 2) {
    const f = v[0], l = v[v.length - 1];
    if ((f === '"' && l === '"') || (f === '\'' && l === '\'')) return v.slice(1, -1);
  }
  return v;
}

// ─── Plugin slug / regression index ────────────────────────────────

function derivePluginSlug(pluginPath: string): string {
  const dirBase = basename(pluginPath);
  let entries: string[];
  try { entries = readdirSync(pluginPath).filter((f) => f.endsWith('.php')); }
  catch { return dirBase; }
  const candidates = [dirBase + '.php', ...entries.filter((e) => e !== dirBase + '.php')].slice(0, 10);
  for (const file of candidates) {
    const source = safeReadFile(join(pluginPath, file));
    if (!source.includes('Plugin Name')) continue;
    const td = source.match(/^\s*\*\s*Text\s*Domain\s*:\s*(.+)$/mi);
    if (td && td[1].trim()) return td[1].trim();
    const name = source.match(/^\s*\*\s*Plugin\s*Name\s*:\s*(.+)$/mi);
    if (name) {
      const slug = name[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (slug) return slug;
    }
  }
  return dirBase;
}

function indexRegressionFixtures(regressionDir: string): Set<string> {
  const ids = new Set<string>();
  if (!dirExists(regressionDir)) return ids;
  let entries: string[];
  try { entries = readdirSync(regressionDir); } catch { return ids; }
  for (const name of entries) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const m = name.match(/^(\d+)[-_]/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// ─── Card → Summary ────────────────────────────────────────────────

function summarizeCard(
  compact: CompactCard, cached: CachedCard | undefined,
  hints: Record<string, RegExp>, regressionIndex: Set<string>,
): CardSummary {
  const id = String(compact.id);
  const comments = cached?.comments ?? [];
  const descriptionHtml = cached?.content ?? '';
  const { sha, branch } = extractFixInfo(comments, descriptionHtml);
  const excerpt = comments.length
    ? stripHtml(comments[0].content).slice(0, 200)
    : stripHtml(descriptionHtml).slice(0, 200);
  const title = cached?.title ?? compact.title ?? '';
  return {
    id,
    title: stripHtml(title),
    createdAt: cached?.created_at ?? compact.created_at ?? '',
    updatedAt: cached?.updated_at ?? compact.updated_at ?? '',
    creator: creatorName(cached?.creator),
    appUrl: cached?.app_url ?? compact.app_url ?? '',
    commentCount: cached?._commentsCount ?? cached?.comments_count ?? compact.comments_count ?? comments.length,
    firstCommentExcerpt: excerpt || undefined,
    fixCommit: sha, fixBranch: branch,
    moduleHints: bucketizeTitle(title, hints),
    hasRegressionFixture: regressionIndex.has(id),
  };
}

function creatorName(creator: CachedCard['creator']): string {
  if (!creator) return 'unknown';
  if (typeof creator === 'string') return creator || 'unknown';
  return creator.name ?? 'unknown';
}

function extractFixInfo(
  comments: FetchedComment[], descriptionHtml: string,
): { sha?: string; branch?: string } {
  const sorted = [...comments].sort((a, b) => {
    const ax = a.created_at ?? '', bx = b.created_at ?? '';
    return ax === bx ? 0 : (ax < bx ? 1 : -1);
  });
  const sources = sorted.map((c) => c.content);
  if (descriptionHtml) sources.push(descriptionHtml);
  const shaRe = /\b([0-9a-f]{7,40})\b/g;
  const contextRe = /\b(commit|fix(ed|es)?|landed|merged|shipped|deploy(ed)?)\b/i;
  const branchRe = /\bbranch[:\s]+([A-Za-z0-9._\/-]+)/i;
  let fallback: string | undefined;
  for (const raw of sources) {
    const text = stripHtml(raw);
    if (!text) continue;
    const matches: string[] = [];
    shaRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = shaRe.exec(text))) { if (/[a-f]/.test(m[1])) matches.push(m[1]); }
    if (!matches.length) continue;
    const branchMatch = text.match(branchRe);
    if (contextRe.test(text)) return { sha: matches[0], branch: branchMatch ? branchMatch[1] : undefined };
    if (!fallback) fallback = matches[0];
  }
  return { sha: fallback };
}

function bucketizeTitle(title: string, hints: Record<string, RegExp>): string[] {
  const out: string[] = [];
  const plain = stripHtml(title);
  for (const [label, re] of Object.entries(hints)) if (re.test(plain)) out.push(label);
  return out;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
    .replace(/\s+/g, ' ').trim();
}

// ─── Insights ──────────────────────────────────────────────────────

function computeInsights(
  columns: BasecampLedgerReport['columns'],
  all: Array<{ column: string; card: CardSummary }>,
  warnings: string[],
): BasecampLedgerReport['insights'] {
  const doneColumn = columns['done'];
  const doneWithoutRegressionFixture = doneColumn
    ? doneColumn.cards.filter((c) => !c.hasRegressionFixture).map((c) => c.id) : [];
  const rftColumn = columns['ready_for_testing'];
  const now = Date.now();
  const readyForTestingAging: AgingCard[] = rftColumn
    ? rftColumn.cards.map((c) => {
        const ms = Date.parse(c.updatedAt);
        const days = Number.isFinite(ms) ? Math.floor((now - ms) / 86_400_000) : 0;
        return { id: c.id, title: c.title, appUrl: c.appUrl, daysInColumn: days };
      }).filter((c) => c.daysInColumn >= AGING_DAYS).sort((a, b) => b.daysInColumn - a.daysInColumn) : [];

  const moduleMap = new Map<string, { count: number; sampleCards: string[] }>();
  for (const s of all) for (const label of s.card.moduleHints) {
    const bucket = moduleMap.get(label) ?? { count: 0, sampleCards: [] };
    bucket.count++;
    if (bucket.sampleCards.length < 5) bucket.sampleCards.push(s.card.id);
    moduleMap.set(label, bucket);
  }
  const topModulesByBugCount: ModuleBucket[] = [...moduleMap.entries()]
    .map(([module, v]) => ({ module, count: v.count, sampleCards: v.sampleCards }))
    .sort((a, b) => b.count - a.count);

  const doneCards = doneColumn?.cards ?? [];
  const withFixSha = doneCards.filter((c) => !!c.fixCommit).length;
  const total = doneCards.length;
  const percentage = total ? Math.round((withFixSha / total) * 1000) / 10 : 0;

  return {
    doneWithoutRegressionFixture, readyForTestingAging,
    reopenDetection: 'not-supported-without-events-api',
    topModulesByBugCount,
    fixCommitCoverage: { total, withFixSha, percentage },
    possibleDuplicates: detectDuplicates(columns),
    warnings,
  };
}

function tokenize(text: string): string[] {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function detectDuplicates(columns: BasecampLedgerReport['columns']): DuplicateCandidate[] {
  const newCards = [
    ...(columns['bugs']?.cards ?? []),
    ...(columns['ready_for_development']?.cards ?? []),
  ];
  const historical = columns['done']?.cards ?? [];
  if (!newCards.length || !historical.length) return [];
  const histTokens = historical.map((c) => ({ id: c.id, set: new Set(tokenize(c.title)) }));
  const out: DuplicateCandidate[] = [];
  for (const neu of newCards) {
    const a = new Set(tokenize(neu.title));
    if (!a.size) continue;
    for (const hist of histTokens) {
      if (!hist.set.size || neu.id === hist.id) continue;
      const shared: string[] = [];
      for (const t of a) if (hist.set.has(t)) shared.push(t);
      if (!shared.length) continue;
      const union = new Set([...a, ...hist.set]).size;
      const score = shared.length / union;
      if (score >= DUPLICATE_SCORE_MIN) {
        out.push({
          newCard: neu.id, historicalCard: hist.id,
          score: Math.round(score * 1000) / 1000,
          sharedKeywords: shared.sort(),
        });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, DUPLICATE_RESULT_CAP);
}

// ─── Markdown Renderer ─────────────────────────────────────────────

function renderLedgerMarkdown(r: BasecampLedgerReport): string {
  const openCols = ['bugs', 'ready_for_development', 'in_development'];
  const openCards = openCols.flatMap((c) =>
    (r.columns[c]?.cards ?? []).map((card) => ({ column: c, card })));
  const rft = r.columns['ready_for_testing']?.cards ?? [];
  const agingMap = new Map(r.insights.readyForTestingAging.map((a) => [a.id, a.daysInColumn]));
  const done = (r.columns['done']?.cards ?? []).slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, RECENT_DONE_LIMIT);
  const cov = r.insights.fixCommitCoverage;
  const missing = r.insights.doneWithoutRegressionFixture;
  const dupes = r.insights.possibleDuplicates;
  const countsRows = Object.entries(r.columns).map(([n, c]) => `| ${n} | ${c.id || '—'} | ${c.count} |`);
  const openLines = openCards.length
    ? openCards.map(({ column, card }) => `- [${column}] ${renderCardLine(card)}`)
    : ['_No cards in Bugs / Ready for Development / In Development._'];
  const rftLines = rft.length ? rft.map((c) => {
    const days = agingMap.get(c.id);
    const age = typeof days === 'number' ? ` _(${days}d since last update)_` : '';
    return `- ${renderCardLine(c)}${age}`;
  }) : ['_No cards in Ready for Testing._'];
  const doneLines = done.length ? done.map((c) => {
    const fix = c.fixCommit ? ` — fix \`${c.fixCommit}\`${c.fixBranch ? ` on ${c.fixBranch}` : ''}` : '';
    const reg = c.hasRegressionFixture ? ' [x] regression' : ' [ ] regression';
    return `- ${renderCardLine(c)}${fix}${reg}`;
  }) : ['_No cards in Done._'];
  const missingLines = missing.length
    ? [...missing.slice(0, 50).map((id) => `- ${id}`),
       ...(missing.length > 50 ? [`- …and ${missing.length - 50} more.`] : [])]
    : ['- All Done cards have a regression fixture.'];
  const agingLines = r.insights.readyForTestingAging.length
    ? r.insights.readyForTestingAging.map((a) => `- [${a.id}](${a.appUrl}) — ${a.title} — ${a.daysInColumn}d`)
    : ['- No RFT cards aged beyond 7 days.'];
  const moduleLines = r.insights.topModulesByBugCount.length
    ? r.insights.topModulesByBugCount.map((m) =>
        `- **${m.module}** — ${m.count} cards (samples: ${m.sampleCards.join(', ')})`)
    : ['- No module hints matched. Configure `module_hints:` in `plan/basecamp.yml`.'];
  const dupeLines = dupes.length
    ? dupes.map((d) => `- **${d.newCard}** ≈ **${d.historicalCard}** (score ${d.score}) — shared: ${d.sharedKeywords.join(', ')}`)
    : ['- No likely duplicates of historical Done cards.'];
  const warningLines = r.insights.warnings.length ? r.insights.warnings.map((w) => `- ${w}`) : ['- None.'];
  return [
    `# Basecamp Ledger — ${r.plugin}`, '',
    `- Project: [${r.projectId}](${r.projectUrl})`,
    `- Snapshot: ${r.snapshotAt}`, '',
    '## Column counts', '', '| Column | ID | Cards |', '| --- | --- | ---: |',
    ...countsRows, '',
    '## Currently open', '', ...openLines, '',
    '## Ready for Testing', '', ...rftLines, '',
    '## Recently Done', '', ...doneLines, '',
    '## Insights', '',
    '### Fix commit coverage', '',
    `- ${cov.withFixSha} / ${cov.total} Done cards cite a commit SHA (${cov.percentage}%).`, '',
    '### Done without regression fixture', '', ...missingLines, '',
    '### Ready-for-Testing aging (>7d)', '', ...agingLines, '',
    '### Recurring reopens', '',
    '- Not supported without the Basecamp events API. Run a dedicated reopen probe via basecamp-mcp-server if needed.', '',
    '### Top modules by bug count', '', ...moduleLines, '',
    '### Possible duplicates (new card ≈ historical Done)', '', ...dupeLines, '',
    '### Warnings', '', ...warningLines, '',
    '---',
    'Regenerate via `wppqa_learn_from_basecamp` — do not hand-edit.', '',
  ].join('\n');
}

function renderCardLine(card: CardSummary): string {
  const modules = card.moduleHints.length ? ` _(${card.moduleHints.join(', ')})_` : '';
  return `[${card.id}](${card.appUrl}) — ${card.title}${modules}`;
}
