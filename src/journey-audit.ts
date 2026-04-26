/**
 * Journey-audit module — customer-experience matrix per release, plugin-agnostic.
 *
 * The MCP owns the *method* (three lenses, severity rubric, briefing prompt
 * shape, matrix consolidation). Each plugin owns its *journeys* — they live
 * in the plugin tree at:
 *
 *   <plugin_path>/docs/audit/journeys.json
 *
 * That file is the source of truth for which customer surfaces matter and
 * what the customer expects from each. A new plugin scaffolds a starter
 * via wppqa_audit_init_journeys and then edits the file to fit its product.
 *
 * Three exported functions, three new MCP tools:
 *
 *   wppqa_audit_init_journeys      -> initJourneys()
 *   wppqa_audit_get_briefing       -> getBriefing()
 *   wppqa_audit_consolidate_matrix -> consolidateMatrix()
 *
 * Dispatching the per-journey audits is the caller's job (Claude's Agent
 * tool), not the MCP's. The MCP returns the briefing prompts; Claude runs
 * them in parallel; Claude calls back to consolidateMatrix when done.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const JOURNEYS_RELPATH = 'docs/audit/journeys.json';

export interface JourneyFeature {
  id: string;
  name: string;
  expectation: string;
}

export interface Journey {
  id: string;
  name: string;
  perspective: string;
  features: JourneyFeature[];
}

export interface JourneyLens {
  id: string;
  label: string;
  prompt: string;
}

export interface SeverityLevel {
  emoji: string;
  label: string;
}

export interface JourneysFile {
  /** A short label for the audit, e.g. "Forum / community plugin (Jetonomy)". */
  product_name: string;
  /** Free-form description of what the audit covers. */
  description?: string;
  /** Three customer-facing lenses. The MCP supplies a default if absent. */
  lenses?: JourneyLens[];
  /** Severity rubric. The MCP supplies a default if absent. */
  severity_rubric?: SeverityLevel[];
  /** Customer journeys; one Sonnet sub-agent runs per journey in parallel. */
  journeys: Journey[];
}

const DEFAULT_LENSES: JourneyLens[] = [
  {
    id: 'customer_expectation',
    label: 'Customer expectation',
    prompt:
      'What would a typical site owner / member expect when they need this?',
  },
  {
    id: 'current_reality',
    label: 'Current reality',
    prompt: 'What actually happens on a fresh install when they try?',
  },
  {
    id: 'long_term_fix',
    label: 'Long-term fix',
    prompt:
      'What change closes the gap (UX / default / missing feature / doc / nothing)?',
  },
];

const DEFAULT_SEVERITY_RUBRIC: SeverityLevel[] = [
  { emoji: '🟢', label: 'matches expectation' },
  {
    emoji: '🟡',
    label:
      'works with friction (workarounds exist, but the user has to learn them)',
  },
  {
    emoji: '🔴',
    label:
      'breaks expectation / sends user to support / forces wp-admin trip for a daily-life task (auto-red, even if it works)',
  },
  { emoji: '⚪', label: 'skipped (third-party dependency not active)' },
];

/* ─────────────────────────────────────────────────────────────── */
/* Tool 1: scaffold a starter journeys.json in the plugin           */
/* ─────────────────────────────────────────────────────────────── */

const STARTER_JOURNEYS: JourneysFile = {
  product_name: 'Replace with your plugin name',
  description:
    'Replace this description. Edit the journeys list below to reflect the customer-facing surfaces of your plugin. Each journey is one customer perspective; each feature is one surface that customer touches. The audit method is plugin-agnostic - the journeys are your contract.',
  lenses: DEFAULT_LENSES,
  severity_rubric: DEFAULT_SEVERITY_RUBRIC,
  journeys: [
    {
      id: 'first-run-setup',
      name: 'First-run + setup',
      perspective: 'Site owner who just activated the plugin',
      features: [
        {
          id: 'plugin-activation',
          name: 'Plugin activation',
          expectation:
            'Activate the plugin, see a clear "what now?" prompt within 30 seconds',
        },
        {
          id: 'setup-wizard',
          name: 'Setup wizard or first-run flow',
          expectation:
            'Produce a working plugin state in <5 minutes; what is still empty after?',
        },
        {
          id: 'first-task',
          name: 'First real task (replace with your domain - first space, first product, first form, etc.)',
          expectation:
            'Site owner accomplishes the headline task without a wp-admin trip when reasonable',
        },
      ],
    },
    {
      id: 'daily-use',
      name: 'Daily use',
      perspective: 'A typical user actually using the plugin day-to-day',
      features: [
        {
          id: 'core-action',
          name: 'Core action (replace with your domain - post, purchase, vote, etc.)',
          expectation:
            'The headline action works at extreme scale, on mobile, with real customer content',
        },
      ],
    },
    {
      id: 'admin',
      name: 'Admin / moderation',
      perspective: 'Running the plugin for a community / store / business',
      features: [
        {
          id: 'admin-list',
          name: 'Admin list and bulk actions',
          expectation:
            'Discover, filter, edit, delete with bulk select and inline edit',
        },
      ],
    },
    {
      id: 'integrations',
      name: 'Integrations + extensions',
      perspective: 'Site owner enabling third-party integrations',
      features: [
        {
          id: 'sample-integration',
          name: 'Sample integration (replace with your real integration list)',
          expectation:
            'Auto-detection works, default config is sane, customer doc matches reality',
        },
      ],
    },
  ],
};

export function initJourneys(args: {
  plugin_path: string;
  force?: boolean;
}): { created: boolean; path: string; preview: string } {
  const target = path.join(args.plugin_path, JOURNEYS_RELPATH);
  const dir = path.dirname(target);
  if (fs.existsSync(target) && !args.force) {
    return {
      created: false,
      path: target,
      preview:
        'File already exists. Pass `force: true` to overwrite, or edit the existing file directly.',
    };
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const json = JSON.stringify(STARTER_JOURNEYS, null, 2) + '\n';
  fs.writeFileSync(target, json, 'utf8');
  return {
    created: true,
    path: target,
    preview:
      'Starter journeys.json scaffolded. Edit it to match your plugin: rename product_name, replace the placeholder features under each journey with real customer-facing surfaces, add or remove journeys as needed. Then call wppqa_audit_get_briefing to generate the per-journey Sonnet sub-agent prompts.',
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* Tool 2: build per-journey briefings                              */
/* ─────────────────────────────────────────────────────────────── */

function loadJourneys(pluginPath: string): JourneysFile {
  const file = path.join(pluginPath, JOURNEYS_RELPATH);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No ${JOURNEYS_RELPATH} found in plugin path "${pluginPath}". ` +
        `Run wppqa_audit_init_journeys first to scaffold a starter, then edit it to match your plugin.`,
    );
  }
  const raw = fs.readFileSync(file, 'utf8');
  let parsed: JourneysFile;
  try {
    parsed = JSON.parse(raw) as JourneysFile;
  } catch (e) {
    throw new Error(
      `${file} is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!parsed.product_name || !Array.isArray(parsed.journeys)) {
    throw new Error(
      `${file} is missing required fields. Expected at minimum: { product_name, journeys: [...] }.`,
    );
  }
  return parsed;
}

function renderSeverityRubric(rubric: SeverityLevel[]): string {
  return rubric.map((r) => `${r.emoji} ${r.label}`).join('\n- ');
}

function renderLenses(lenses: JourneyLens[]): string {
  return lenses.map((l) => `- **${l.label}:** ${l.prompt}`).join('\n');
}

function renderFeatureList(journey: Journey): string {
  return journey.features
    .map(
      (f, i) =>
        `${i + 1}. **${f.name}** (\`${f.id}\`) — ${f.expectation}`,
    )
    .join('\n');
}

function buildBriefing(
  product: JourneysFile,
  journey: Journey,
  pluginPath: string,
  siteUrl: string,
  outputPath: string,
): string {
  const lenses = product.lenses ?? DEFAULT_LENSES;
  const rubric = product.severity_rubric ?? DEFAULT_SEVERITY_RUBRIC;

  return `You are auditing a WordPress plugin for the customer-experience matrix. This is QA, not coding. Do NOT fix anything; produce findings only.

## Product

${product.product_name}${product.description ? ` — ${product.description}` : ''}

## Your scope: ${journey.name}

Perspective: ${journey.perspective}

Audit these ${journey.features.length} feature units. Each is one customer-facing surface, not a code module:

${renderFeatureList(journey)}

## Method

Three lenses per feature:
${renderLenses(lenses)}

Severity:
- ${renderSeverityRubric(rubric)}

A wp-admin trip for a daily-life task is automatically 🔴, even if it works. Cite file:line / DOM evidence; no speculation.

## Environment

- Plugin path: \`${pluginPath}\`
- Site: ${siteUrl}
- Auto-login: append \`?autologin=1\` to any URL for admin (member logins use \`?autologin=<login>\` if the plugin supports it).
- Tools available: Read, Bash (wp-cli + grep + ls), Grep, Glob, mcp__plugin_playwright_playwright__* for browser walks at 1280px and 390px, mcp__mcp-local-wp__* for DB queries.

## Output

Write a single Markdown file at \`${outputPath}\` with this structure:

\`\`\`markdown
# ${journey.name} audit

Run date: <ISO 8601>
Plugin: ${product.product_name}

## Summary

| Feature | Severity | One-line gap |
|---|---|---|
| <feature name> | 🟢/🟡/🔴/⚪ | ... |
| ... | | |

## 1. <Feature 1 name>

### Customer expectation
<one or two sentences>

### Current reality
<observed behaviour with file:line / DOM evidence>

### Long-term fix
<what closes the gap; tag if current-cycle / next-cycle / docs-only / wontfix>

### Severity: 🟢/🟡/🔴/⚪
\`\`\`

In your final message back, give an executive summary under 250 words: severity counts, list each 🔴 + 🟡 with one-line description, absolute path to the saved file.

## Important rules

- No em-dashes in your output. Use colons, commas, or " - ".
- No "likely / probably / should be" diagnoses. Observations only with file:line or DOM evidence.
- A wp-admin trip for a daily-life task is automatically 🔴.
- A default that surprises a typical site owner is 🟡 minimum.
- Audit the STATE OF TODAY. If a planned release fixes a gap, note that in the long-term-fix recommendation.

Report when done.`;
}

export interface BriefingArgs {
  plugin_path: string;
  site_url?: string;
  output_dir?: string;
}

export interface JourneyBriefing {
  journey_id: string;
  journey_name: string;
  prompt: string;
  output_path: string;
}

export function getBriefing(args: BriefingArgs): {
  product_name: string;
  briefings: JourneyBriefing[];
  consolidate_hint: string;
} {
  const product = loadJourneys(args.plugin_path);
  const siteUrl = args.site_url ?? 'http://localhost';
  const outputDir =
    args.output_dir ??
    `/tmp/${path.basename(args.plugin_path)}-audit-${Date.now()}`;

  const briefings: JourneyBriefing[] = product.journeys.map((j) => ({
    journey_id: j.id,
    journey_name: j.name,
    prompt: buildBriefing(
      product,
      j,
      args.plugin_path,
      siteUrl,
      `${outputDir}/${j.id}.md`,
    ),
    output_path: `${outputDir}/${j.id}.md`,
  }));

  return {
    product_name: product.product_name,
    briefings,
    consolidate_hint: `After all sub-agents finish, call wppqa_audit_consolidate_matrix with the list of paths returned in briefings[].output_path to get the final customer-experience matrix.`,
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* Tool 3: consolidate matrix                                       */
/* ─────────────────────────────────────────────────────────────── */

interface ParsedReport {
  journey_id: string;
  journey_name: string;
  red: Array<{ feature: string; gap: string }>;
  yellow: Array<{ feature: string; gap: string }>;
  green: Array<{ feature: string; gap: string }>;
  skipped: Array<{ feature: string; gap: string }>;
}

/** Identify a severity cell - emoji or word, case-insensitive. */
function severityFromCell(
  cell: string,
): 'red' | 'yellow' | 'green' | 'skipped' | null {
  const c = cell.trim();
  if (c === '🔴' || c.toUpperCase() === 'RED') return 'red';
  if (c === '🟡' || c.toUpperCase() === 'YELLOW') return 'yellow';
  if (c === '🟢' || c.toUpperCase() === 'GREEN') return 'green';
  if (c === '⚪' || c.toUpperCase() === 'SKIPPED') return 'skipped';
  return null;
}

/** Find the column index whose value matches the severity column header. */
function findSeverityColumn(headerCells: string[]): number {
  for (let i = 0; i < headerCells.length; i++) {
    if (headerCells[i].trim().toLowerCase() === 'severity') {
      return i;
    }
  }
  return -1;
}

function parseReport(filePath: string): ParsedReport {
  const text = fs.readFileSync(filePath, 'utf8');
  const journeyId = path.basename(filePath, '.md');
  const journeyName =
    text.match(/^#\s+(.+?)\s+audit/im)?.[1] ?? journeyId;

  const red: ParsedReport['red'] = [];
  const yellow: ParsedReport['yellow'] = [];
  const green: ParsedReport['green'] = [];
  const skipped: ParsedReport['skipped'] = [];

  // Walk the file line by line. Find table blocks (consecutive `|`-rows),
  // identify the severity column from the header, then extract feature +
  // severity + gap from each data row. This handles 3-col tables (Feature |
  // Severity | Gap) and 4-col tables (# | Feature | Severity | Gap) and
  // anything else with a "Severity" column header.
  const lines = text.split(/\r?\n/);
  let inTable = false;
  let severityCol = -1;
  let featureCol = -1;
  let gapCol = -1;

  const splitRow = (line: string): string[] =>
    line
      .split('|')
      .slice(1, -1) // drop empty cells from leading and trailing `|`
      .map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableRow = /^\|.*\|/.test(line);

    if (!isTableRow) {
      inTable = false;
      severityCol = -1;
      continue;
    }

    // Start of a table: the header row. Next row should be a separator
    // (`|---|---|...`) followed by data rows.
    if (!inTable) {
      const headerCells = splitRow(line);
      severityCol = findSeverityColumn(headerCells);
      if (severityCol === -1) {
        // Not a severity-shaped table; skip.
        continue;
      }
      // Default convention: feature is the column immediately before
      // severity, gap is the column immediately after. Falls through if
      // either is out of range.
      featureCol = severityCol - 1;
      gapCol = severityCol + 1;
      // If the column before severity is "#" or numeric-looking, push
      // featureCol to severityCol - 2.
      if (featureCol >= 0) {
        const before = headerCells[featureCol].trim().toLowerCase();
        if (before === '#' || before === 'index') {
          featureCol = severityCol - 2;
        }
      }
      inTable = true;
      continue;
    }

    // Separator row between header and data: `|---|---|...`
    if (/^\|[\s|:-]+\|$/.test(line) || /^\|\s*-+/.test(line)) {
      continue;
    }

    // Data row.
    const cells = splitRow(line);
    if (
      severityCol < 0 ||
      severityCol >= cells.length ||
      featureCol < 0 ||
      featureCol >= cells.length
    ) {
      continue;
    }
    const sev = severityFromCell(cells[severityCol]);
    if (!sev) {
      continue;
    }
    const feature = cells[featureCol];
    const gap = gapCol >= 0 && gapCol < cells.length ? cells[gapCol] : '';
    if (!feature || feature.startsWith('---')) {
      continue;
    }
    const entry = { feature, gap };
    if (sev === 'red') red.push(entry);
    else if (sev === 'yellow') yellow.push(entry);
    else if (sev === 'green') green.push(entry);
    else if (sev === 'skipped') skipped.push(entry);
  }

  return {
    journey_id: journeyId,
    journey_name: journeyName,
    red,
    yellow,
    green,
    skipped,
  };
}

function renderMatrix(
  productName: string,
  reports: ParsedReport[],
  pluginPath: string,
  reportPaths: string[],
): string {
  const totals = reports.reduce(
    (acc, r) => ({
      red: acc.red + r.red.length,
      yellow: acc.yellow + r.yellow.length,
      green: acc.green + r.green.length,
      skipped: acc.skipped + r.skipped.length,
    }),
    { red: 0, yellow: 0, green: 0, skipped: 0 },
  );
  const sum =
    totals.red + totals.yellow + totals.green + totals.skipped;
  const pct = (n: number): string =>
    sum > 0 ? `${Math.round((n * 100) / sum)}%` : '0%';

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Customer-experience matrix: ${productName}`);
  lines.push('');
  lines.push(`**Audit date:** ${today}`);
  lines.push(`**Plugin path:** \`${pluginPath}\``);
  lines.push(
    `**Method:** parallel Sonnet sub-agents per customer journey, three lenses (customer expectation / current reality / long-term fix), severity rubric (🟢 matches expectation, 🟡 friction, 🔴 broken, ⚪ skipped — third-party not active). Journeys defined in \`${JOURNEYS_RELPATH}\`.`,
  );
  lines.push('**Per-journey reports:**');
  for (const p of reportPaths) {
    lines.push(`- \`${p}\``);
  }
  lines.push('');
  lines.push('## Severity counts');
  lines.push('');
  lines.push('| Slice | 🔴 | 🟡 | 🟢 | ⚪ | Total |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of reports) {
    const t =
      r.red.length + r.yellow.length + r.green.length + r.skipped.length;
    lines.push(
      `| ${r.journey_name} | ${r.red.length} | ${r.yellow.length} | ${r.green.length} | ${r.skipped.length} | ${t} |`,
    );
  }
  lines.push(
    `| **Total** | **${totals.red}** | **${totals.yellow}** | **${totals.green}** | **${totals.skipped}** | **${sum}** |`,
  );
  lines.push('');
  lines.push(
    `${totals.red} of ${sum} audited surfaces (${pct(totals.red)}) break customer expectation. ${totals.yellow} (${pct(totals.yellow)}) work with friction.`,
  );
  lines.push('');

  lines.push('## Reds (sorted by journey)');
  lines.push('');
  if (totals.red === 0) {
    lines.push(
      '_No 🔴 findings. Plugin matches customer expectation across every audited journey._',
    );
  } else {
    lines.push('| Journey | Surface | Today |');
    lines.push('|---|---|---|');
    for (const r of reports) {
      for (const f of r.red) {
        lines.push(`| ${r.journey_name} | ${f.feature} | ${f.gap} |`);
      }
    }
  }
  lines.push('');

  lines.push('## Yellows by journey');
  lines.push('');
  let anyYellow = false;
  for (const r of reports) {
    if (r.yellow.length === 0) {
      continue;
    }
    anyYellow = true;
    lines.push(`### ${r.journey_name}`);
    for (const f of r.yellow) {
      lines.push(`- **${f.feature}** — ${f.gap}`);
    }
    lines.push('');
  }
  if (!anyYellow) {
    lines.push('_No 🟡 findings._');
    lines.push('');
  }

  lines.push('## Greens');
  lines.push('');
  let anyGreen = false;
  for (const r of reports) {
    if (r.green.length === 0) {
      continue;
    }
    anyGreen = true;
    const names = r.green.map((f) => f.feature).join(', ');
    lines.push(`- **${r.journey_name}:** ${names}`);
  }
  if (!anyGreen) {
    lines.push('_No 🟢 findings._');
  }
  lines.push('');

  if (totals.skipped > 0) {
    lines.push('## Skipped (third-party dependency not active)');
    lines.push('');
    for (const r of reports) {
      for (const f of r.skipped) {
        lines.push(
          `- **${r.journey_name} / ${f.feature}** — ${f.gap}`,
        );
      }
    }
    lines.push('');
  }

  lines.push('## Living-doc rule');
  lines.push('');
  lines.push(
    'Regenerate this matrix per release using the same five-journey audit. Re-running the audit after the next release should show 🔴 shrinking, 🟢 growing. Track deferred items here with their target version.',
  );

  return lines.join('\n');
}

export interface ConsolidateArgs {
  report_paths: string[];
  plugin_path: string;
  output_path: string;
}

export function consolidateMatrix(args: ConsolidateArgs): {
  output_path: string;
  totals: {
    red: number;
    yellow: number;
    green: number;
    skipped: number;
    total: number;
  };
  reds: string[];
} {
  // Best-effort: load product name from the plugin's journeys.json if present.
  let productName = path.basename(args.plugin_path);
  const journeysFile = path.join(args.plugin_path, JOURNEYS_RELPATH);
  if (fs.existsSync(journeysFile)) {
    try {
      const j = JSON.parse(
        fs.readFileSync(journeysFile, 'utf8'),
      ) as JourneysFile;
      if (j.product_name) {
        productName = j.product_name;
      }
    } catch {
      // fall through with directory basename
    }
  }

  const reports = args.report_paths.map(parseReport);
  const matrix = renderMatrix(
    productName,
    reports,
    args.plugin_path,
    args.report_paths,
  );

  const dir = path.dirname(args.output_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(args.output_path, matrix, 'utf8');

  const totals = reports.reduce(
    (acc, r) => ({
      red: acc.red + r.red.length,
      yellow: acc.yellow + r.yellow.length,
      green: acc.green + r.green.length,
      skipped: acc.skipped + r.skipped.length,
    }),
    { red: 0, yellow: 0, green: 0, skipped: 0 },
  );
  const sum =
    totals.red + totals.yellow + totals.green + totals.skipped;

  const reds: string[] = [];
  for (const r of reports) {
    for (const f of r.red) {
      reds.push(`${r.journey_name} / ${f.feature}: ${f.gap}`);
    }
  }

  return {
    output_path: args.output_path,
    totals: { ...totals, total: sum },
    reds,
  };
}
