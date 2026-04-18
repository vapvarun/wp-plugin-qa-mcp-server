/**
 * WP Plugin QA MCP Server - Basecamp Learner
 *
 * Plugin-agnostic Basecamp ledger generator. Reads `plan/basecamp.yml`
 * from the plugin, walks every declared column, pulls cards + comments,
 * extracts institutional knowledge (fix SHAs, module hints, regression
 * coverage, aging, reopens) and writes `plan/basecamp/ledger.md` +
 * `ledger.json` so future sessions carry full bug history without
 * re-querying Basecamp.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { dirExists, fileExists, safeReadFile } from './shared-utils.js';

// ─── Public Types ──────────────────────────────────────────────────

export interface LearnFromBasecampOptions {
  pluginPath: string;
  accountId?: string;
  accessToken?: string;
  maxCardsPerColumn?: number;
  writeLedger?: boolean;
  includeComments?: boolean;
}

export interface BasecampLedgerReport {
  plugin: string;
  projectId: string;
  projectUrl: string;
  snapshotAt: string;
  columns: Record<string, { id: string; count: number; cards: CardSummary[] }>;
  insights: {
    doneWithoutRegressionFixture: string[];
    readyForTestingAging: AgingCard[];
    recurringReopens: ReopenPattern[];
    topModulesByBugCount: ModuleBucket[];
    fixCommitCoverage: { total: number; withFixSha: number; percentage: number };
  };
  writtenFiles: string[];
}

export interface CardSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  creator: string;
  appUrl: string;
  commentCount: number;
  firstCommentExcerpt?: string;
  fixCommit?: string;
  fixBranch?: string;
  moduleHints: string[];
  hasRegressionFixture: boolean;
}

export interface AgingCard { id: string; title: string; appUrl: string; daysInColumn: number; }
export interface ReopenPattern { id: string; title: string; timesReopened: number; lastReopenAt?: string; }
export interface ModuleBucket { module: string; count: number; sampleCards: string[]; }

// ─── Internal Types ────────────────────────────────────────────────

interface BasecampConfig {
  projectId: string;
  cardTableId?: string;
  projectUrl: string;
  columns: Record<string, string>;
  moduleHints: Record<string, RegExp>;
}

interface RawCard {
  id: number; title: string; created_at: string; updated_at: string;
  creator?: { name?: string }; app_url: string; comments_count?: number; content?: string;
}
interface RawComment { id: number; created_at: string; updated_at: string; content: string; creator?: { name?: string }; }
interface RawEvent { id: number; created_at: string; action?: string; details?: Record<string, unknown>; }

// ─── Constants ─────────────────────────────────────────────────────

const USER_AGENT = 'WP-Plugin-QA MCP (admin@wbcomdesigns.com)';
const AGING_THRESHOLD_DAYS = 7;
const RECENT_DONE_LIMIT = 20;
const REOPEN_PROBE_CAP = 50;

// ─── Entry ─────────────────────────────────────────────────────────

export async function learnFromBasecamp(
  opts: LearnFromBasecampOptions,
): Promise<BasecampLedgerReport> {
  const pluginPath = opts.pluginPath;
  if (!pluginPath || !dirExists(pluginPath)) {
    throw new Error(`learnFromBasecamp: pluginPath does not exist or is not a directory: ${pluginPath}`);
  }
  const accountId = opts.accountId ?? process.env.BASECAMP_ACCOUNT_ID ?? '';
  const accessToken = opts.accessToken ?? process.env.BASECAMP_ACCESS_TOKEN ?? '';
  if (!accountId || !accessToken) {
    throw new Error(
      'learnFromBasecamp: missing Basecamp credentials. Set BASECAMP_ACCOUNT_ID and BASECAMP_ACCESS_TOKEN env vars, or pass { accountId, accessToken } explicitly.',
    );
  }
  const configPath = join(pluginPath, 'plan', 'basecamp.yml');
  if (!fileExists(configPath)) {
    throw new Error(
      `learnFromBasecamp: missing config at ${configPath}. Create plan/basecamp.yml with project_id, project_url, and a columns map.`,
    );
  }
  const cfg = parseBasecampConfig(safeReadFile(configPath), configPath);
  const maxPerColumn = Math.max(1, opts.maxCardsPerColumn ?? 500);
  const includeComments = opts.includeComments !== false;
  const writeLedger = opts.writeLedger !== false;

  const pluginSlug = derivePluginSlug(pluginPath);
  const regressionIndex = indexRegressionFixtures(join(pluginPath, 'plan', 'regression'));

  // Fetch columns in parallel; pagination per column is sequential.
  const fetched = await Promise.all(
    Object.entries(cfg.columns).map(async ([name, columnId]) => ({
      name,
      columnId,
      raw: await fetchCards(accountId, accessToken, cfg.projectId, columnId, maxPerColumn),
    })),
  );

  const columns: BasecampLedgerReport['columns'] = {};
  const all: Array<{ column: string; card: CardSummary }> = [];
  for (const { name, columnId, raw } of fetched) {
    const cards: CardSummary[] = [];
    for (const card of raw) {
      let comments: RawComment[] = [];
      if (includeComments && (card.comments_count ?? 0) > 0) {
        comments = await fetchComments(accountId, accessToken, cfg.projectId, card.id).catch(() => []);
      }
      const summary = summarizeCard(card, comments, cfg.moduleHints, regressionIndex);
      cards.push(summary);
      all.push({ column: name, card: summary });
    }
    columns[name] = { id: columnId, count: cards.length, cards };
  }

  const snapshotAt = new Date().toISOString();
  const insights = await computeInsights(accountId, accessToken, cfg, columns, all);

  const writtenFiles: string[] = [];
  const report: BasecampLedgerReport = {
    plugin: pluginSlug,
    projectId: cfg.projectId,
    projectUrl: cfg.projectUrl,
    snapshotAt, columns, insights, writtenFiles,
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

// ─── YAML-lite Parser ──────────────────────────────────────────────
// The config shape is deterministic: top-level scalars, two nested maps
// (`columns`, `module_hints`). No lists, flow style, or anchors.

function parseBasecampConfig(source: string, configPath: string): BasecampConfig {
  let projectId = '', projectUrl = '';
  let cardTableId: string | undefined;
  const columns: Record<string, string> = {};
  const moduleHintsRaw: Record<string, string> = {};
  type Section = 'root' | 'columns' | 'module_hints';
  let section: Section = 'root';

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
      else if (key === 'card_table_id') cardTableId = value;
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

  return {
    projectId, cardTableId,
    projectUrl: projectUrl || `https://3.basecamp.com/buckets/${projectId}`,
    columns, moduleHints,
  };
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

// ─── Plugin Slug Detection ─────────────────────────────────────────

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

// ─── Regression Fixture Index ──────────────────────────────────────

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

// ─── Basecamp API ──────────────────────────────────────────────────

async function fetchCards(accountId: string, token: string, projectId: string, columnId: string, max: number): Promise<RawCard[]> {
  return paginate<RawCard>(`https://3.basecampapi.com/${accountId}/buckets/${projectId}/card_tables/lists/${columnId}/cards.json`, token, max);
}
async function fetchComments(accountId: string, token: string, projectId: string, cardId: number): Promise<RawComment[]> {
  return paginate<RawComment>(`https://3.basecampapi.com/${accountId}/buckets/${projectId}/recordings/${cardId}/comments.json`, token, 200);
}
async function fetchEvents(accountId: string, token: string, projectId: string, cardId: number): Promise<RawEvent[]> {
  return paginate<RawEvent>(`https://3.basecampapi.com/${accountId}/buckets/${projectId}/recordings/${cardId}/events.json`, token, 200);
}

async function paginate<T>(firstUrl: string, token: string, maxItems: number): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = firstUrl;
  let guard = 0;
  while (url && results.length < maxItems && guard < 50) {
    guard++;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Basecamp API ${resp.status} ${resp.statusText} for ${url}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }
    const batch = (await resp.json()) as T[];
    if (Array.isArray(batch)) {
      for (const item of batch) {
        results.push(item);
        if (results.length >= maxItems) break;
      }
    }
    url = parseNextLink(resp.headers.get('Link'));
  }
  return results;
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
    if (m) return m[1];
  }
  return null;
}

// ─── Card → Summary ────────────────────────────────────────────────

function summarizeCard(card: RawCard, comments: RawComment[], hints: Record<string, RegExp>, regressionIndex: Set<string>): CardSummary {
  const id = String(card.id);
  const { sha, branch } = extractFixInfo(comments);
  const excerpt = comments.length
    ? stripHtml(comments[0].content).slice(0, 200)
    : stripHtml(card.content ?? '').slice(0, 200);
  return {
    id,
    title: stripHtml(card.title),
    createdAt: card.created_at,
    updatedAt: card.updated_at,
    creator: card.creator?.name ?? 'unknown',
    appUrl: card.app_url,
    commentCount: card.comments_count ?? comments.length,
    firstCommentExcerpt: excerpt || undefined,
    fixCommit: sha,
    fixBranch: branch,
    moduleHints: bucketizeTitle(card.title, hints),
    hasRegressionFixture: regressionIndex.has(id),
  };
}

function extractFixInfo(comments: RawComment[]): { sha?: string; branch?: string } {
  // Newest-first so the most recent fix SHA wins.
  const sorted = [...comments].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const shaRe = /\b([0-9a-f]{7,40})\b/g;
  const contextRe = /\b(commit|fix(ed|es)?|landed|merged|shipped|deploy(ed)?)\b/i;
  const branchRe = /\bbranch[:\s]+([A-Za-z0-9._\/-]+)/i;

  let fallback: string | undefined;
  for (const c of sorted) {
    const text = stripHtml(c.content);
    if (!text) continue;
    const matches: string[] = [];
    shaRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = shaRe.exec(text))) {
      // Require at least one a-f hex letter so pure digit runs (years, IDs) don't win.
      if (/[a-f]/.test(m[1])) matches.push(m[1]);
    }
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

async function computeInsights(
  accountId: string, accessToken: string, cfg: BasecampConfig,
  columns: BasecampLedgerReport['columns'],
  all: Array<{ column: string; card: CardSummary }>,
): Promise<BasecampLedgerReport['insights']> {
  const doneColumn = columns['done'];
  const doneWithoutRegressionFixture = doneColumn
    ? doneColumn.cards.filter((c) => !c.hasRegressionFixture).map((c) => c.id)
    : [];

  const rftColumn = columns['ready_for_testing'];
  const now = Date.now();
  const readyForTestingAging: AgingCard[] = rftColumn
    ? rftColumn.cards
        .map((c) => {
          const ms = Date.parse(c.updatedAt);
          const days = Number.isFinite(ms) ? Math.floor((now - ms) / 86_400_000) : 0;
          return { id: c.id, title: c.title, appUrl: c.appUrl, daysInColumn: days };
        })
        .filter((c) => c.daysInColumn >= AGING_THRESHOLD_DAYS)
        .sort((a, b) => b.daysInColumn - a.daysInColumn)
    : [];

  // Reopen probes limited to Bugs/RFT/In-Testing (done-column entries are quiescent)
  const reopenTargets = all.filter((s) =>
    s.column === 'bugs' || s.column === 'ready_for_testing' || s.column === 'in_testing',
  );
  const recurringReopens: ReopenPattern[] = [];
  const bugsId = cfg.columns['bugs'];
  const doneId = cfg.columns['done'];
  for (const t of reopenTargets.slice(0, REOPEN_PROBE_CAP)) {
    try {
      const events = await fetchEvents(accountId, accessToken, cfg.projectId, Number(t.card.id));
      const r = countReopens(events, bugsId, doneId);
      if (r.times > 0) {
        recurringReopens.push({ id: t.card.id, title: t.card.title, timesReopened: r.times, lastReopenAt: r.lastAt });
      }
    } catch { /* non-fatal — events endpoint occasionally 404s */ }
  }
  recurringReopens.sort((a, b) => b.timesReopened - a.timesReopened);

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
    doneWithoutRegressionFixture,
    readyForTestingAging,
    recurringReopens,
    topModulesByBugCount,
    fixCommitCoverage: { total, withFixSha, percentage },
  };
}

function countReopens(events: RawEvent[], bugsId: string | undefined, doneId: string | undefined): { times: number; lastAt?: string } {
  if (!bugsId || !doneId) return { times: 0 };
  let times = 0;
  let lastAt: string | undefined;
  for (const ev of events) {
    const d = (ev.details ?? {}) as Record<string, unknown>;
    const fromId = extractIdLike(d['from']);
    const toId = extractIdLike(d['to']);
    const fromLabel = extractLabelLike(d['from']);
    const toLabel = extractLabelLike(d['to']);
    const moved = (fromId === doneId && toId === bugsId) || (/done/i.test(fromLabel) && /bug/i.test(toLabel));
    if (moved) { times++; if (!lastAt || ev.created_at > lastAt) lastAt = ev.created_at; }
  }
  return { times, lastAt };
}

function extractIdLike(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.id === 'number' || typeof v.id === 'string') return String(v.id);
  }
  return '';
}

function extractLabelLike(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.title === 'string') return v.title;
    if (typeof v.name === 'string') return v.name;
  }
  return '';
}

// ─── Markdown Renderer ─────────────────────────────────────────────

function renderLedgerMarkdown(r: BasecampLedgerReport): string {
  const openCols = ['bugs', 'ready_for_development', 'in_development'];
  const openCards = openCols.flatMap((c) =>
    (r.columns[c]?.cards ?? []).map((card) => ({ column: c, card })),
  );
  const rft = r.columns['ready_for_testing']?.cards ?? [];
  const agingMap = new Map(r.insights.readyForTestingAging.map((a) => [a.id, a.daysInColumn]));
  const done = (r.columns['done']?.cards ?? [])
    .slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, RECENT_DONE_LIMIT);
  const cov = r.insights.fixCommitCoverage;
  const missing = r.insights.doneWithoutRegressionFixture;

  const countsRows = Object.entries(r.columns).map(([n, c]) => `| ${n} | ${c.id} | ${c.count} |`);
  const openLines = openCards.length
    ? openCards.map(({ column, card }) => `- [${column}] ${renderCardLine(card)}`)
    : ['_No cards in Bugs / Ready for Development / In Development._'];
  const rftLines = rft.length
    ? rft.map((c) => {
        const days = agingMap.get(c.id);
        const age = typeof days === 'number' ? ` _(${days}d since last update)_` : '';
        return `- ${renderCardLine(c)}${age}`;
      })
    : ['_No cards in Ready for Testing._'];
  const doneLines = done.length
    ? done.map((c) => {
        const fix = c.fixCommit ? ` — fix \`${c.fixCommit}\`${c.fixBranch ? ` on ${c.fixBranch}` : ''}` : '';
        const reg = c.hasRegressionFixture ? ' [x] regression' : ' [ ] regression';
        return `- ${renderCardLine(c)}${fix}${reg}`;
      })
    : ['_No cards in Done._'];
  const missingLines = missing.length
    ? [
        ...missing.slice(0, 50).map((id) => `- ${id}`),
        ...(missing.length > 50 ? [`- …and ${missing.length - 50} more.`] : []),
      ]
    : ['- All Done cards have a regression fixture.'];
  const agingLines = r.insights.readyForTestingAging.length
    ? r.insights.readyForTestingAging.map((a) => `- [${a.id}](${a.appUrl}) — ${a.title} — ${a.daysInColumn}d`)
    : ['- No RFT cards aged beyond 7 days.'];
  const reopenLines = r.insights.recurringReopens.length
    ? r.insights.recurringReopens.map((p) =>
        `- ${p.id} — ${p.title} — reopened ${p.timesReopened}x${p.lastReopenAt ? ` (last ${p.lastReopenAt})` : ''}`)
    : ['- No reopen patterns detected.'];
  const moduleLines = r.insights.topModulesByBugCount.length
    ? r.insights.topModulesByBugCount.map((m) =>
        `- **${m.module}** — ${m.count} cards (samples: ${m.sampleCards.join(', ')})`)
    : ['- No module hints matched. Configure `module_hints:` in `plan/basecamp.yml`.'];

  return [
    `# Basecamp Ledger — ${r.plugin}`,
    '',
    `- Project: [${r.projectId}](${r.projectUrl})`,
    `- Snapshot: ${r.snapshotAt}`,
    '',
    '## Column counts',
    '',
    '| Column | ID | Cards |',
    '| --- | --- | ---: |',
    ...countsRows,
    '',
    '## Currently open',
    '',
    ...openLines,
    '',
    '## Ready for Testing',
    '',
    ...rftLines,
    '',
    '## Recently Done',
    '',
    ...doneLines,
    '',
    '## Insights',
    '',
    '### Fix commit coverage',
    '',
    `- ${cov.withFixSha} / ${cov.total} Done cards cite a commit SHA (${cov.percentage}%).`,
    '',
    '### Done without regression fixture',
    '',
    ...missingLines,
    '',
    '### Ready-for-Testing aging (>7d)',
    '',
    ...agingLines,
    '',
    '### Recurring reopens',
    '',
    ...reopenLines,
    '',
    '### Top modules by bug count',
    '',
    ...moduleLines,
    '',
    '---',
    'Regenerate via `wppqa_learn_from_basecamp` — do not hand-edit.',
    '',
  ].join('\n');
}

function renderCardLine(card: CardSummary): string {
  const modules = card.moduleHints.length ? ` _(${card.moduleHints.join(', ')})_` : '';
  return `[${card.id}](${card.appUrl}) — ${card.title}${modules}`;
}
