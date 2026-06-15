# Manifest v2 — Options-Wiring Extractor (Plan 1 of N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a deterministic `scanOptionsWiring()` extractor to the MCP scanner so the manifest records, for every WordPress option the plugin uses, exactly where it is **written**, **read**, and **enforced** — the data the `contract` (dead-toggle) check needs to run on any plugin.

**Architecture:** One new extractor function in `src/scanner.ts` following the existing
`scanX(phpFiles, contents, pluginPath)` pattern, one new `OptionWiringInfo` type in `src/types.ts`,
wired into the `scanPlugin()` result under `features.optionsWiring`. It greps `get_option` /
`update_option` / `add_option` / `delete_option` across all PHP, groups by option name, and classifies
each call site as read / write, marking a read site as an **enforcement** site when it sits inside a
conditional or an early `return`/`WP_Error`. Pure static analysis, no runtime.

**Tech Stack:** TypeScript (Node), `node:test` + `node:assert` (built-in, already used in
`src/__tests__/`), regex over file contents (matches every other extractor in `scanner.ts`).

**Scope note:** This is plan 1 of N. Sibling plans (same extractor pattern, separate files) cover
`features` grouping (FeatureRegistry), `templates` loader_args/vars_used, `rest` request_args +
gated_by, `hooks↔listeners`, and `frontend_js` calls_rest/reads_keys. They are NOT in this plan.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/types.ts` | manifest types | ADD `OptionWiringInfo`, `OptionSite`; add `optionsWiring` to `PluginManifest.features` |
| `src/scanner.ts` | deterministic extractors | ADD `scanOptionsWiring()`; call it in `scanPlugin()`; include in returned manifest |
| `src/__tests__/scanner-options-wiring.test.ts` | test | CREATE — fixture-driven unit test |

---

### Task 1: Types for option wiring

**Files:**
- Modify: `src/types.ts` (add interfaces near `SettingInfo`, ~line 591 region; add field to `PluginManifest.features` ~line 256)

- [ ] **Step 1: Add the two interfaces**

In `src/types.ts`, immediately after the existing `SettingInfo` interface, add:

```typescript
/** One call site touching a WordPress option. */
export interface OptionSite {
  file: string;
  line: number;
  /** 'read' = get_option; 'write' = update_option/add_option; 'delete' = delete_option. */
  kind: 'read' | 'write' | 'delete';
  /** True when a read site sits inside a conditional or guards an early return/WP_Error
   *  (i.e. the option actually GATES behaviour, not just displays it). */
  enforces: boolean;
}

/** Every place a single option is wired across the plugin. */
export interface OptionWiringInfo {
  optionName: string;
  /** Default value passed to the first get_option(name, <default>) found, or '' if none. */
  defaultValue: string;
  writtenAt: OptionSite[];
  readAt: OptionSite[];
  /** Subset of readAt where enforces === true. Empty array = "saved but never enforced" (dead toggle smell). */
  enforcedAt: OptionSite[];
}
```

- [ ] **Step 2: Expose it on the manifest**

In `src/types.ts`, inside `export interface PluginManifest { features: { ... } }` (the block starting
~line 256 that already lists `restRoutes`, `settings`, `templates`), add this line after `settings`:

```typescript
    optionsWiring: OptionWiringInfo[];
```

- [ ] **Step 3: Commit**

```bash
cd ~/.mcp-servers/wp-plugin-qa-mcp-server
git add src/types.ts
git commit -m "types: add OptionWiringInfo for manifest v2 options-wiring"
```

---

### Task 2: The extractor (test first)

**Files:**
- Create: `src/__tests__/scanner-options-wiring.test.ts`
- Modify: `src/scanner.ts` (add `scanOptionsWiring`, call it in `scanPlugin`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/scanner-options-wiring.test.ts`:

```typescript
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanOptionsWiring } from '../scanner.js';

// A fixture mimicking the real BN pattern: an option written in admin, read+enforced
// in a REST guard, and read (not enforced) in a template.
const ADMIN = `<?php update_option( 'buddynext_allow_shares', '1' );`;
const REST = `<?php
function share() {
  if ( ! (bool) get_option( 'buddynext_allow_shares', true ) ) {
    return new WP_Error( 'shares_disabled', 'x', array( 'status' => 403 ) );
  }
}`;
const TPL = `<?php $can = get_option( 'buddynext_allow_shares', true ); echo $can;`;

function fixture(): { files: string[]; contents: Map<string, string> } {
  const contents = new Map<string, string>([
    ['/p/admin.php', ADMIN],
    ['/p/rest.php', REST],
    ['/p/tpl.php', TPL],
  ]);
  return { files: [...contents.keys()], contents };
}

describe('scanOptionsWiring', () => {
  it('records write, read, and enforcement sites for one option', () => {
    const { files, contents } = fixture();
    const rows = scanOptionsWiring(files, contents, '/p');
    const row = rows.find((r) => r.optionName === 'buddynext_allow_shares');
    assert.ok(row, 'option should be found');
    assert.equal(row!.writtenAt.length, 1, 'one write site (admin update_option)');
    assert.equal(row!.readAt.length, 2, 'two read sites (rest + tpl)');
    assert.equal(row!.enforcedAt.length, 1, 'one enforcement site (the REST guard)');
    assert.equal(row!.enforcedAt[0].file, 'rest.php');
    assert.equal(row!.defaultValue, 'true');
  });

  it('flags a saved-but-never-enforced option (dead toggle smell) with empty enforcedAt', () => {
    const contents = new Map<string, string>([
      ['/p/a.php', `<?php update_option( 'buddynext_dead', '1' ); $x = get_option( 'buddynext_dead' );`],
    ]);
    const rows = scanOptionsWiring([...contents.keys()], contents, '/p');
    const row = rows.find((r) => r.optionName === 'buddynext_dead');
    assert.ok(row);
    assert.equal(row!.enforcedAt.length, 0, 'no enforcement → dead toggle smell');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails (function not exported yet)**

```bash
cd ~/.mcp-servers/wp-plugin-qa-mcp-server && npm run build 2>&1 | head -5
```
Expected: TypeScript build error — `Module '"../scanner.js"' has no exported member 'scanOptionsWiring'`.

- [ ] **Step 3: Implement `scanOptionsWiring`**

In `src/scanner.ts`, add this function next to `scanSettings` (after it, ~line 626). It reuses the
existing `relativePath` and `getLineNumber` helpers already in the file:

```typescript
// --- Scanner: Options wiring (manifest v2) ---
// Finds every get_option/update_option/add_option/delete_option call, groups by
// option name, and marks a read as an ENFORCEMENT when it sits inside a conditional
// or guards an early return/WP_Error within ~200 chars after the call.
export function scanOptionsWiring(
  phpFiles: string[],
  contents: Map<string, string>,
  pluginPath: string,
): OptionWiringInfo[] {
  const byName = new Map<string, OptionWiringInfo>();
  // Capture: fn name, option name, optional default (first arg group after the name).
  const re = /\b(get_option|update_option|add_option|delete_option)\s*\(\s*['"]([A-Za-z0-9_]+)['"]\s*(?:,\s*([^),]+))?/g;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const fn = m[1];
      const name = m[2];
      const rawDefault = (m[3] || '').trim();
      const line = getLineNumber(content, m.index);
      let row = byName.get(name);
      if (!row) {
        row = { optionName: name, defaultValue: '', writtenAt: [], readAt: [], enforcedAt: [] };
        byName.set(name, row);
      }
      if (fn === 'get_option') {
        if (!row.defaultValue && rawDefault) row.defaultValue = rawDefault;
        const enforces = isEnforcementSite(content, m.index);
        const site: OptionSite = { file: rel, line, kind: 'read', enforces };
        row.readAt.push(site);
        if (enforces) row.enforcedAt.push(site);
      } else if (fn === 'delete_option') {
        row.writtenAt.push({ file: rel, line, kind: 'delete', enforces: false });
      } else {
        row.writtenAt.push({ file: rel, line, kind: 'write', enforces: false });
      }
    }
  }
  return [...byName.values()];
}

// A read is an enforcement when the call is the subject of a conditional (the line
// starts an `if (`, or `! get_option`), or a return/WP_Error appears within 200 chars.
function isEnforcementSite(content: string, idx: number): boolean {
  const lineStart = content.lastIndexOf('\n', idx) + 1;
  const before = content.slice(lineStart, idx);
  if (/\bif\s*\(\s*!?\s*\(?\s*(?:\(bool\)\s*)?$/.test(before) || /!\s*\(?\s*(?:\(bool\)\s*)?$/.test(before)) {
    return true;
  }
  const after = content.slice(idx, idx + 200);
  return /\breturn\b|WP_Error/.test(after) && /\bif\b/.test(before + after.slice(0, 40));
}
```

- [ ] **Step 4: Add the import + wire into `scanPlugin`**

At the top of `src/scanner.ts`, ensure the type import line that pulls from `./types.js` includes
`OptionWiringInfo` and `OptionSite` (add them to the existing `import type { ... } from './types.js'`).

In `scanPlugin()` (~line 50, next to `const settings = scanSettings(...)`), add:

```typescript
  const optionsWiring = scanOptionsWiring(phpFiles, phpContents, pluginPath);
```

Then in the returned manifest object's `features: { ... }` block (where `settings` is assigned), add:

```typescript
      optionsWiring,
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd ~/.mcp-servers/wp-plugin-qa-mcp-server && npm test 2>&1 | grep -E "pass|fail|scanOptionsWiring"
```
Expected: `# pass 2`, `# fail 0`, both `scanOptionsWiring` tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/scanner.ts src/types.ts src/__tests__/scanner-options-wiring.test.ts
git commit -m "scanner: add deterministic options-wiring extractor (manifest v2)"
```

---

### Task 3: Verify against the real buddynext plugin

**Files:** none (verification only)

- [ ] **Step 1: Run the extractor on buddynext and inspect a known option**

```bash
cd ~/.mcp-servers/wp-plugin-qa-mcp-server && node --input-type=module -e '
import { scanPlugin } from "./build/scanner.js";
const m = scanPlugin("/Users/vapvarun/dev/repos/buddynext");
const ow = m.features.optionsWiring || [];
const shares = ow.find(o => o.optionName === "buddynext_allow_shares");
console.log("options found:", ow.length);
console.log("buddynext_allow_shares:", JSON.stringify(shares, null, 2));
'
```
Expected: `options found:` is a non-trivial count (dozens); `buddynext_allow_shares` shows ≥1
`writtenAt`, ≥1 `readAt`, and ≥1 `enforcedAt` (the ShareService guard). If `enforcedAt` is empty for
an option you KNOW is enforced, the `isEnforcementSite` heuristic needs widening — note it but do not
fail the task; the next plan (cert `contract`) is the runtime confirmation that catches false negatives.

- [ ] **Step 2: Confirm no crash on a second plugin (cross-product check)**

```bash
node --input-type=module -e '
import { scanPlugin } from "./build/scanner.js";
const m = scanPlugin("/Users/vapvarun/dev/repos/jetonomy");
console.log("jetonomy options found:", (m.features.optionsWiring||[]).length);
'
```
Expected: a number, no exception — proves the extractor is plugin-agnostic.

---

## Self-Review

- **Spec coverage:** implements the `options[]` section of manifest v2 (written_at/read_at/enforced_at
  + default + gates-smell). The `gates` field (which routes an option controls) is intentionally
  deferred to the `rest.gated_by` sibling plan — noted, not silently dropped.
- **Placeholder scan:** none — every step has exact code/commands.
- **Type consistency:** `OptionWiringInfo`/`OptionSite` field names (`optionName`, `writtenAt`,
  `readAt`, `enforcedAt`, `defaultValue`, `kind`, `enforces`) are identical across types.ts, the
  extractor, the test, and the verification script.

## Done when

`npm test` green (2 new tests), `scanPlugin(buddynext).features.optionsWiring` lists real options with
write/read/enforce sites, and the same call on jetonomy returns without error.
