/**
 * WP Plugin QA MCP Server - Functional Certification delegate.
 *
 * The deterministic behavioural gate. This does NOT analyse code or return
 * advisory prose — that was the failure mode of the older `wppqa_check_*`
 * tools. It SHELLS OUT to the plugin's own `wp <namespace> cert --json`
 * command (the Certify engine that lives in the plugin, see
 * docs/plans/functional-certification-system.md) and returns the raw,
 * machine-verified ledger: every gated setting flipped + asserted, every route
 * booted, every uncovered surface reported as a HOLE.
 *
 * Division of labour (the rule that makes this trustworthy):
 *   - The engine (code) decides pass/fail. Deterministic.
 *   - The MCP (here) only transports the verdict.
 *   - The LLM may PROPOSE new oracles for HOLEs — it never IS the check.
 *
 * Plugin-agnostic: any plugin exposing a `cert` WP-CLI subcommand works; the
 * caller supplies the WP root and the CLI namespace.
 */

import { execFileSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanPlugin } from './scanner.js';

export interface CertifyOptions {
  /** Absolute path to the WordPress root the plugin is active on. */
  wpRoot: string;
  /** Plugin CLI namespace, e.g. "buddynext" → `wp buddynext cert`. */
  cliNamespace: string;
  /** Optional single check: "contract" | "boot". Omit to run all. */
  check?: string;
}

export interface CertifyLedger {
  ok: boolean;
  summary: Record<string, number>;
  rows: Array<{ check: string; entity: string; status: string; detail: string }>;
}

export interface CertifyResult {
  ran: boolean;
  ledger?: CertifyLedger;
  /** Raw stdout when JSON could not be parsed (engine missing, error, etc.). */
  raw?: string;
  error?: string;
}

/**
 * Run the plugin's Certify engine and return its ledger.
 *
 * `wp ... cert --json` prints the ledger then exits non-zero on failure, so a
 * thrown execFileSync error still carries the ledger on its stdout — we parse
 * that rather than treating a "red" gate as a transport error.
 */
export function runCertify(opts: CertifyOptions): CertifyResult {
  const { wpRoot, cliNamespace, check } = opts;
  if (!wpRoot) return { ran: false, error: 'wp_root is required' };
  if (!cliNamespace) return { ran: false, error: 'cli_namespace is required (e.g. "buddynext")' };

  const args = [`--path=${wpRoot}`, ...cliNamespace.split(/\s+/), 'cert'];
  if (check) args.push(check);
  // --porcelain, not --json: WP-CLI reserves --json for its formatter.
  args.push('--porcelain');

  let stdout = '';
  try {
    stdout = execFileSync('wp', args, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });
  } catch (e: unknown) {
    // Non-zero exit (a failing gate) still prints the JSON ledger to stdout.
    const err = e as { stdout?: string; message?: string };
    stdout = err.stdout ?? '';
    if (!stdout) {
      return { ran: false, error: `cert command failed: ${err.message ?? 'unknown error'}` };
    }
  }

  const parsed = extractJson(stdout);
  if (!parsed) return { ran: true, raw: stdout, error: 'could not parse cert ledger JSON' };
  return { ran: true, ledger: parsed };
}

/**
 * Tolerantly extract the JSON ledger from CLI output (WP-CLI may prepend PHP
 * deprecation/imagick noise on some local stacks).
 */
function extractJson(out: string): CertifyLedger | undefined {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(out.slice(start, end + 1)) as CertifyLedger;
  } catch {
    return undefined;
  }
}

/**
 * Render the ledger as a compact, human-skimmable summary for the MCP caller,
 * leading with what matters: failures, then holes (the self-improvement
 * backlog), then the headline counts.
 */
export function formatCertify(result: CertifyResult): string {
  if (!result.ran) return `Certify did not run: ${result.error ?? 'unknown error'}`;
  if (!result.ledger) {
    return `Certify ran but its ledger could not be parsed.\n${result.error ?? ''}\n\n${(result.raw ?? '').slice(0, 2000)}`;
  }
  const { ok, summary, rows } = result.ledger;
  const fails = rows.filter((r) => r.status === 'fail');
  const holes = rows.filter((r) => r.status === 'hole');

  const lines: string[] = [];
  lines.push(ok ? '✓ FUNCTIONAL CERTIFICATION PASSED' : '✗ FUNCTIONAL CERTIFICATION FAILED');
  lines.push(`${summary.pass} passed · ${summary.fail} failed · ${summary.hole} holes (uncovered)`);
  if (fails.length) {
    lines.push('\nFAILURES (a feature does not behave — fix before merge):');
    for (const f of fails) lines.push(`  ✗ ${f.check}/${f.entity} — ${f.detail}`);
  }
  if (holes.length) {
    lines.push('\nHOLES (no oracle yet — add one to audit/cert-oracles.json):');
    for (const h of holes) lines.push(`  ? ${h.entity}`);
  }
  return lines.join('\n');
}

/**
 * Run the GENERIC engine (plugin-agnostic) against any plugin: scan it to a manifest,
 * write the manifest to /tmp, then `wp eval-file engine/cert-engine.php <manifest> [oracles]`.
 * This is the path that works for all 100+ products with no per-plugin PHP.
 */
export function runEngine(opts: { wpRoot: string; pluginPath: string; oraclesPath?: string; rescan?: boolean }): CertifyResult {
  const { wpRoot, pluginPath, oraclesPath, rescan } = opts;
  if (!wpRoot) return { ran: false, error: 'wp_root is required' };
  if (!pluginPath) return { ran: false, error: 'plugin_path is required' };

  // Prefer the committed, deterministic manifest (generation decoupled from checking).
  // Re-scan live only when asked, or when no committed manifest exists.
  const committed = join(pluginPath, 'audit', 'manifest.json');
  let manifestPath: string;
  if (!rescan && existsSync(committed)) {
    manifestPath = committed;
  } else {
    manifestPath = join(tmpdir(), `cert-manifest-${process.pid}.json`);
    writeFileSync(manifestPath, JSON.stringify(scanPlugin(pluginPath)));
  }

  const enginePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'cert-engine.php');
  const args = [`--path=${wpRoot}`, 'eval-file', enginePath, manifestPath];
  if (oraclesPath) args.push(oraclesPath);

  let stdout = '';
  try {
    stdout = execFileSync('wp', args, { encoding: 'utf-8', stdio: 'pipe', timeout: 180000 });
  } catch (e: unknown) {
    const err = e as { stdout?: string; message?: string };
    stdout = err.stdout ?? '';
    if (!stdout) return { ran: false, error: `engine failed: ${err.message ?? 'unknown'}` };
  }
  const parsed = extractJson(stdout);
  if (!parsed) return { ran: true, raw: stdout, error: 'could not parse engine ledger JSON' };
  return { ran: true, ledger: parsed };
}

/** Format the generic engine ledger: failures first, then candidates (unconfirmed), then counts. */
export function formatEngine(result: CertifyResult): string {
  if (!result.ran) return `Engine did not run: ${result.error ?? 'unknown error'}`;
  if (!result.ledger) return `Engine ran but ledger unparseable.\n${(result.raw ?? '').slice(0, 2000)}`;
  const { ok, summary, rows } = result.ledger;
  const fails = rows.filter((r) => r.status === 'fail');
  const cands = rows.filter((r) => r.status === 'candidate');
  const lines: string[] = [];
  lines.push(ok ? '✓ FUNCTIONAL CERTIFICATION PASSED' : '✗ FUNCTIONAL CERTIFICATION FAILED');
  lines.push(`${summary.pass ?? 0} passed · ${summary.fail ?? 0} failed · ${summary.candidate ?? 0} candidates (unconfirmed)`);
  if (fails.length) {
    lines.push('\nFAILURES (confirmed — a feature does not behave):');
    for (const f of fails) lines.push(`  ✗ ${f.check}/${f.entity} — ${f.detail}`);
  }
  if (cands.length) {
    lines.push('\nCANDIDATES (static smell — confirm or add an oracle):');
    for (const c of cands.slice(0, 40)) lines.push(`  ? ${c.entity} — ${c.detail}`);
    if (cands.length > 40) lines.push(`  …and ${cands.length - 40} more`);
  }
  return lines.join('\n');
}
