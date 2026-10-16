# Flow Audit Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, MCP-native semantic data-flow audit suite (FlowGraph + 6 checkers + runner/report) and run it on the BuddyNext free+pro pair to produce a go-live findings report.

**Architecture:** A PHP-AST sidecar (`nikic/php-parser`) emits raw PHP facts as JSON; TS modules under `src/flow/` build a typed FlowGraph (nodes+edges) over distribution-only files, cached incrementally by per-file sha1 in `audit/flow.json`. Each checker is a pure `(graph) => CheckerResult`. A runner aggregates them, applies a stable-ID baseline, and renders `audit/flow-audit-report.md`.

**Tech Stack:** TypeScript (Node16 ESM, `node:test`), PHP 8 + `nikic/php-parser`, existing MCP `CheckerResult`/`shared-utils` infra.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-19-flow-audit-skeleton-design.md` (authoritative).
- Scan scope = distribution allowlist derived from each repo's `bin/build-release.sh` (`RUNTIME[]`+`OPTIONAL[]`); `libs/`+`vendor/` are call *targets* only, never scanned for findings; `tests/ docs/ plan*/ audit*/ bin/ mu-plugins/ node_modules/ *.md` never scanned.
- Fixtures: BN free `/Users/vapvarun/dev/repos/buddynext`, Pro `/Users/vapvarun/dev/repos/buddynext-pro`.
- TS imports use `.js` extension (Node16 ESM). Tests live in `src/__tests__/<name>.test.ts`, run via `npm run build && node --test build/__tests__/<name>.test.js`.
- Finding IDs are content-derived/stable (never `generateTestId()` for baselined findings).
- All new checkers return the existing `CheckerResult` shape from `src/types.ts`.
- No version bumps anywhere. No Claude co-author in commits.
- Do not register tools in `server.ts` this pass (out of scope); the runner is invoked via a node CLI entry.

---

### Task 1: PHP-AST sidecar — emit raw PHP facts as JSON

**Files:**
- Create: `php-ast/composer.json`
- Create: `php-ast/extract-graph.php`
- Test: `src/__tests__/php-sidecar.test.ts`
- Create (test fixture): `php-ast/__fixtures__/sample.php`

**Interfaces:**
- Produces: a CLI `php php-ast/extract-graph.php <dir> [<dir2> ...]` that prints one JSON object to stdout:
  ```
  {
    symbols:   Array<{kind:'function'|'method', name:string, class:string|null, fqn:string, file:string, line:number, bodyHash:string, params:string[], visibility:string|null, abstract:boolean}>,
    calls:     Array<{fromFqn:string|null, toName:string, viaService:string|null, file:string, line:number}>,
    registrations: Array<{hook:string, callback:string, mechanism:string, file:string, line:number}>,
    serviceBindings: Array<{id:string, class:string, file:string, line:number}>,
    hooksFired: Array<{hook:string, file:string, line:number}>,
    templatesLoaded: Array<{template:string, argKeys:string[], file:string, line:number}>,
    errors: Array<{file:string, message:string}>
  }
  ```
  `file` paths are relative to the scanned `<dir>`. `bodyHash` = sha1 of the statement list pretty-print with comments stripped. `viaService` is set when the call target is `buddynext_service('id')->method()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/php-sidecar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');           // build/__tests__ -> repo root
const sidecar = join(repoRoot, 'php-ast', 'extract-graph.php');
const fixtureDir = join(repoRoot, 'php-ast', '__fixtures__');

test('sidecar extracts functions, methods, calls, registrations, service bindings', () => {
  const out = execFileSync('php', [sidecar, fixtureDir], { encoding: 'utf8' });
  const g = JSON.parse(out);
  const fnNames = g.symbols.filter((s: any) => s.kind === 'function').map((s: any) => s.name);
  assert.ok(fnNames.includes('sample_helper'), 'finds top-level function');
  const method = g.symbols.find((s: any) => s.kind === 'method' && s.name === 'render');
  assert.equal(method.class, 'Sample\\Widget');
  assert.ok(method.bodyHash && method.bodyHash.length === 40, 'method has sha1 bodyHash');
  assert.ok(g.calls.some((c: any) => c.toName === 'sample_helper'), 'records a direct call');
  assert.ok(g.calls.some((c: any) => c.viaService === 'feed'), 'records a service-locator call');
  assert.ok(g.registrations.some((r: any) => r.hook === 'init'), 'records add_action registration');
  assert.ok(g.serviceBindings.some((b: any) => b.id === 'feed'), 'records a service binding');
});
```

- [ ] **Step 2: Create the fixture**

```php
// php-ast/__fixtures__/sample.php
<?php
namespace Sample;

function sample_helper(string $x): string { return strtoupper($x); }

class Widget {
    public function render(): string {
        $s = sample_helper('hi');
        $feed = buddynext_service('feed')->latest();
        return $s . $feed;
    }
}

add_action('init', [Widget::class, 'render']);
// service container binding shape used by BuddyNext:
$services['feed'] = static fn() => new Widget();
```

- [ ] **Step 3: Create `php-ast/composer.json`**

```json
{
  "name": "wbcom/wppqa-php-ast",
  "description": "PHP-AST fact extractor for the flow-audit FlowGraph.",
  "require": { "php": ">=8.0", "nikic/php-parser": "^5.0" },
  "config": { "optimize-autoloader": true }
}
```

- [ ] **Step 4: Install php-parser**

Run: `cd php-ast && composer install --quiet && cd ..`
Expected: `php-ast/vendor/autoload.php` exists.

- [ ] **Step 5: Write `php-ast/extract-graph.php`**

```php
<?php
declare(strict_types=1);
// Emit raw PHP facts (symbols/calls/registrations/service bindings/hooks/templates) as JSON.
// Usage: php extract-graph.php <dir> [<dir> ...]
require __DIR__ . '/vendor/autoload.php';

use PhpParser\{ParserFactory, NodeFinder, Node, PrettyPrinter, NodeTraverser, NodeVisitorAbstract};
use PhpParser\Node\Stmt\{Function_, ClassMethod, Class_};
use PhpParser\Node\Expr\{FuncCall, MethodCall, StaticCall};

$dirs = array_slice($argv, 1);
$parser  = (new ParserFactory())->createForNewestSupportedVersion();
$printer = new PrettyPrinter\Standard();
$finder  = new NodeFinder();

$out = ['symbols'=>[], 'calls'=>[], 'registrations'=>[], 'serviceBindings'=>[],
        'hooksFired'=>[], 'templatesLoaded'=>[], 'errors'=>[]];

function rel(string $abs, string $base): string { return ltrim(substr($abs, strlen($base)), '/'); }

function constStr(?Node $n): ?string {
    if ($n instanceof Node\Scalar\String_) return $n->value;
    if ($n instanceof Node\Expr\ClassConstFetch && $n->class instanceof Node\Name) return $n->class->toString();
    if ($n instanceof Node\Expr\Array_ && count($n->items) === 2) {
        $a = constStr($n->items[0]->value); $b = constStr($n->items[1]->value);
        return ($a !== null && $b !== null) ? "$a::$b" : null;
    }
    return null;
}

foreach ($dirs as $dir) {
    $dir = rtrim($dir, '/');
    $rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($rii as $f) {
        if ($f->getExtension() !== 'php') continue;
        $abs = $f->getPathname(); $relf = rel($abs, $dir);
        try { $ast = $parser->parse(file_get_contents($abs)); }
        catch (\Throwable $e) { $out['errors'][] = ['file'=>$relf, 'message'=>$e->getMessage()]; continue; }
        if ($ast === null) continue;

        // Track current namespace + class for FQNs.
        $ns = ''; $cls = null;
        $visitor = new class($out, $relf, $printer) extends NodeVisitorAbstract {
            public function __construct(public array &$out, public string $relf, public $printer, public string $ns='', public ?string $cls=null) {}
            public function enterNode(Node $n) {
                if ($n instanceof Node\Stmt\Namespace_) $this->ns = $n->name ? $n->name->toString() : '';
                if ($n instanceof Class_ && $n->name) $this->cls = ($this->ns ? $this->ns.'\\' : '').$n->name->toString();
                if ($n instanceof Function_) {
                    $this->out['symbols'][] = ['kind'=>'function','name'=>$n->name->toString(),
                        'class'=>null,'fqn'=>($this->ns?$this->ns.'\\':'').$n->name->toString(),
                        'file'=>$this->relf,'line'=>$n->getStartLine(),
                        'bodyHash'=>sha1($this->printer->prettyPrint($n->stmts ?? [])),
                        'params'=>array_map(fn($p)=>$p->var->name ?? '', $n->params),'visibility'=>null,'abstract'=>false];
                }
                if ($n instanceof ClassMethod && $this->cls) {
                    $this->out['symbols'][] = ['kind'=>'method','name'=>$n->name->toString(),
                        'class'=>$this->cls,'fqn'=>$this->cls.'::'.$n->name->toString(),
                        'file'=>$this->relf,'line'=>$n->getStartLine(),
                        'bodyHash'=>sha1($this->printer->prettyPrint($n->stmts ?? [])),
                        'params'=>array_map(fn($p)=>$p->var->name ?? '', $n->params),
                        'visibility'=>$n->isPublic()?'public':($n->isProtected()?'protected':'private'),
                        'abstract'=>$n->isAbstract()];
                }
                $fromFqn = $this->cls; // best-effort enclosing scope
                if ($n instanceof FuncCall && $n->name instanceof Node\Name) {
                    $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$n->name->toString(),'viaService'=>null,
                        'file'=>$this->relf,'line'=>$n->getStartLine()];
                    $fn = $n->name->toString();
                    if (in_array($fn, ['add_action','add_filter'], true) && isset($n->args[0],$n->args[1])) {
                        $hook = self::s($n->args[0]->value); $cb = self::cb($n->args[1]->value);
                        if ($hook!==null) $this->out['registrations'][] = ['hook'=>$hook,'callback'=>$cb??'','mechanism'=>$fn,'file'=>$this->relf,'line'=>$n->getStartLine()];
                    }
                    if (in_array($fn, ['do_action','apply_filters'], true) && isset($n->args[0])) {
                        $hook = self::s($n->args[0]->value);
                        if ($hook!==null) $this->out['hooksFired'][] = ['hook'=>$hook,'file'=>$this->relf,'line'=>$n->getStartLine()];
                    }
                    if (in_array($fn, ['buddynext_get_template','buddynext_get_template_html'], true) && isset($n->args[0])) {
                        $tpl = self::s($n->args[0]->value); $keys = [];
                        if (isset($n->args[1]) && $n->args[1]->value instanceof Node\Expr\Array_)
                            foreach ($n->args[1]->value->items as $it) { $k=self::s($it->key); if($k!==null)$keys[]=$k; }
                        if ($tpl!==null) $this->out['templatesLoaded'][] = ['template'=>$tpl,'argKeys'=>$keys,'file'=>$this->relf,'line'=>$n->getStartLine()];
                    }
                }
                // Service-locator: buddynext_service('id')->method()
                if ($n instanceof MethodCall && $n->var instanceof FuncCall
                    && $n->var->name instanceof Node\Name && $n->var->name->toString()==='buddynext_service'
                    && isset($n->var->args[0])) {
                    $sid = self::s($n->var->args[0]->value);
                    $m = $n->name instanceof Node\Identifier ? $n->name->toString() : null;
                    if ($sid!==null) $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$m??'','viaService'=>$sid,'file'=>$this->relf,'line'=>$n->getStartLine()];
                }
                // Service binding: $services['id'] = ... new Class / fn()=>new Class
                if ($n instanceof Node\Expr\Assign && $n->var instanceof Node\Expr\ArrayDimFetch
                    && $n->var->var instanceof Node\Expr\Variable && $n->var->var->name==='services') {
                    $sid = self::s($n->var->dim);
                    $clsName = self::firstNewClass($n->expr);
                    if ($sid!==null && $clsName!==null) $this->out['serviceBindings'][] = ['id'=>$sid,'class'=>$clsName,'file'=>$this->relf,'line'=>$n->getStartLine()];
                }
                return null;
            }
            static function s(?Node $n): ?string { return $n instanceof Node\Scalar\String_ ? $n->value : null; }
            static function cb(?Node $n): ?string { return constStr($n); }
            static function firstNewClass(Node $e): ?string {
                if ($e instanceof Node\Expr\New_ && $e->class instanceof Node\Name) return $e->class->toString();
                if ($e instanceof Node\Expr\ArrowFunction) return self::firstNewClass($e->expr);
                if ($e instanceof Node\Expr\Closure) { foreach($e->stmts as $st){ if($st instanceof Node\Stmt\Return_ && $st->expr) return self::firstNewClass($st->expr);} }
                return null;
            }
        };
        $trav = new NodeTraverser(); $trav->addVisitor($visitor); $trav->traverse($ast);
    }
}
echo json_encode($out);
```

- [ ] **Step 6: Run the test**

Run: `npm run build && node --test build/__tests__/php-sidecar.test.js`
Expected: PASS (all 7 assertions).

- [ ] **Step 7: Commit**

```bash
git add php-ast/composer.json php-ast/extract-graph.php php-ast/__fixtures__/sample.php src/__tests__/php-sidecar.test.ts
git commit -m "feat(flow): PHP-AST sidecar emits raw PHP facts as JSON"
```

---

### Task 2: Distribution scan scope

**Files:**
- Create: `src/flow/scope.ts`
- Test: `src/__tests__/scope.test.ts`

**Interfaces:**
- Produces: `resolveScanScope(repoRoot: string): { includeDirs: string[]; thirdParty: string[] }`
  - `includeDirs` = absolute paths of allowlisted RUNTIME+OPTIONAL entries that exist, EXCLUDING third-party.
  - `thirdParty` = absolute paths of `libs`/`vendor` that exist (call targets, not scanned for findings).
  - Parses `bin/build-release.sh` `RUNTIME=( … )` / `OPTIONAL=( … )`. Falls back to a default allowlist if absent.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/scope.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScanScope } from '../flow/scope.js';

test('resolves BN free distribution allowlist, excludes tests/docs, isolates third-party', () => {
  const { includeDirs, thirdParty } = resolveScanScope('/Users/vapvarun/dev/repos/buddynext');
  const base = (p: string) => p.split('/').pop();
  const names = includeDirs.map(base);
  assert.ok(names.includes('includes') && names.includes('templates'), 'includes runtime dirs');
  assert.ok(!names.includes('tests') && !names.includes('docs') && !names.includes('plan'), 'excludes non-shipped');
  assert.ok(thirdParty.map(base).includes('libs'), 'libs is third-party');
  assert.ok(!names.includes('libs') && !names.includes('vendor'), 'third-party not in includeDirs');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/scope.test.js`
Expected: FAIL — cannot find module `../flow/scope.js`.

- [ ] **Step 3: Implement `src/flow/scope.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirExists, fileExists } from '../shared-utils.js';

const THIRD_PARTY = new Set(['libs', 'vendor']);
const DEFAULT_RUNTIME = ['includes', 'templates', 'assets', 'blocks'];

function parseArray(sh: string, name: string): string[] {
  const m = sh.match(new RegExp(name + '=\\(([^)]*)\\)'));
  if (!m) return [];
  return m[1].split(/\s+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

export function resolveScanScope(repoRoot: string): { includeDirs: string[]; thirdParty: string[] } {
  const buildSh = join(repoRoot, 'bin', 'build-release.sh');
  let entries: string[];
  if (fileExists(buildSh)) {
    const sh = readFileSync(buildSh, 'utf8');
    entries = [...parseArray(sh, 'RUNTIME'), ...parseArray(sh, 'OPTIONAL')];
  } else {
    entries = [...DEFAULT_RUNTIME];
  }
  const include: string[] = [];
  const third: string[] = [];
  for (const e of entries) {
    const abs = join(repoRoot, e);
    if (!dirExists(abs) && !fileExists(abs)) continue;
    if (THIRD_PARTY.has(e)) third.push(abs); else include.push(abs);
  }
  // Always treat vendor/libs as third-party even if not in allowlist.
  for (const e of THIRD_PARTY) {
    const abs = join(repoRoot, e);
    if (dirExists(abs) && !third.includes(abs)) third.push(abs);
  }
  return { includeDirs: include, thirdParty: third };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/scope.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/flow/scope.ts src/__tests__/scope.test.ts
git commit -m "feat(flow): distribution-only scan scope from build-release allowlist"
```

---

### Task 3: Per-file fingerprint cache

**Files:**
- Create: `src/flow/fingerprint.ts`
- Test: `src/__tests__/fingerprint.test.ts`

**Interfaces:**
- Produces:
  - `fingerprintFiles(files: string[], repoRoot: string): Record<string, string>` — relPath → sha1(relPath + content).
  - `diffFingerprints(prev: Record<string,string>, next: Record<string,string>): { changed: string[]; deleted: string[] }` — `changed` = added or modified relPaths; `deleted` = removed.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/fingerprint.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffFingerprints } from '../flow/fingerprint.js';

test('diff reports added, modified, deleted', () => {
  const prev = { 'a.php': 'h1', 'b.php': 'h2' };
  const next = { 'a.php': 'h1', 'b.php': 'h2-mod', 'c.php': 'h3' };
  const { changed, deleted } = diffFingerprints(prev, next);
  assert.deepEqual(changed.sort(), ['b.php', 'c.php']);
  assert.deepEqual(deleted, ['a.php'].filter(() => false)); // a unchanged, none deleted
  assert.deepEqual(deleted, []);
});

test('diff reports deletion', () => {
  const { deleted } = diffFingerprints({ 'x.php': 'h' }, {});
  assert.deepEqual(deleted, ['x.php']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/fingerprint.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/flow/fingerprint.ts`**

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relativePath } from '../shared-utils.js';

export function fingerprintFiles(files: string[], repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const rel = relativePath(f, repoRoot);
    let content = '';
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    out[rel] = createHash('sha1').update(rel + '\0' + content).digest('hex');
  }
  return out;
}

export function diffFingerprints(
  prev: Record<string, string>,
  next: Record<string, string>,
): { changed: string[]; deleted: string[] } {
  const changed: string[] = [];
  for (const [rel, h] of Object.entries(next)) if (prev[rel] !== h) changed.push(rel);
  const deleted: string[] = [];
  for (const rel of Object.keys(prev)) if (!(rel in next)) deleted.push(rel);
  return { changed, deleted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/fingerprint.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/flow/fingerprint.ts src/__tests__/fingerprint.test.ts
git commit -m "feat(flow): per-file sha1 fingerprint + diff for incremental cache"
```

---

### Task 4: Graph model, stable IDs, flow.json IO

**Files:**
- Create: `src/flow/graph.ts`
- Modify: `src/types.ts` (append flow types)
- Test: `src/__tests__/graph.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  ```ts
  export type FlowNodeKind = 'route'|'method'|'function'|'service'|'template'|'hook'|'jsConsumer'|'option'|'table';
  export type FlowEdgeKind = 'calls'|'returns'|'reads'|'loads'|'fires'|'consumes'|'gatedBy'|'registers';
  export interface FlowNode { id:string; kind:FlowNodeKind; name:string; file:string; line:number; repo:'free'|'pro'; meta?:Record<string,unknown>; }
  export interface FlowEdge { from:string; to:string; kind:FlowEdgeKind; file:string; line:number; meta?:Record<string,unknown>; }
  export interface FlowGraph { nodes:Record<string,FlowNode>; edges:FlowEdge[]; fingerprints:Record<string,string>; repos:{free:string; pro?:string}; generated:string; }
  ```
- Produces (in `graph.ts`):
  - `nodeId(kind: FlowNodeKind, key: string): string` → `"${kind}:${key}"`.
  - `emptyGraph(repos, generated): FlowGraph`.
  - `addNode(g, node)`, `addEdge(g, edge)` (addNode dedups by id; last write wins).
  - `inbound(g, id, kinds?): FlowEdge[]`, `outbound(g, id, kinds?): FlowEdge[]`.
  - `nodesByKind(g, kind): FlowNode[]`.
  - `writeGraph(path, g): void`, `readGraph(path): FlowGraph | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/graph.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeId, emptyGraph, addNode, addEdge, inbound, outbound, nodesByKind } from '../flow/graph.js';

test('stable node ids and edge queries', () => {
  const g = emptyGraph({ free: '/free' }, '2026-01-01T00:00:00Z');
  const a = nodeId('function', 'foo'), b = nodeId('function', 'bar');
  assert.equal(a, 'function:foo');
  addNode(g, { id: a, kind: 'function', name: 'foo', file: 'a.php', line: 1, repo: 'free' });
  addNode(g, { id: b, kind: 'function', name: 'bar', file: 'b.php', line: 2, repo: 'free' });
  addEdge(g, { from: b, to: a, kind: 'calls', file: 'b.php', line: 3 });
  assert.equal(nodesByKind(g, 'function').length, 2);
  assert.equal(inbound(g, a, ['calls']).length, 1, 'foo has 1 inbound call');
  assert.equal(inbound(g, b, ['calls']).length, 0, 'bar has 0 inbound calls');
  assert.equal(outbound(g, b).length, 1);
});

test('addNode dedups by id', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: 'function:x', kind: 'function', name: 'x', file: 'a', line: 1, repo: 'free' });
  addNode(g, { id: 'function:x', kind: 'function', name: 'x', file: 'a', line: 9, repo: 'free' });
  assert.equal(Object.keys(g.nodes).length, 1);
  assert.equal(g.nodes['function:x'].line, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/graph.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Append flow types to `src/types.ts`**

Append the `FlowNodeKind`/`FlowEdgeKind`/`FlowNode`/`FlowEdge`/`FlowGraph` block from the Interfaces section above to the end of `src/types.ts`.

- [ ] **Step 4: Implement `src/flow/graph.ts`**

```ts
import { writeFileSync, readFileSync } from 'node:fs';
import { fileExists } from '../shared-utils.js';
import type { FlowGraph, FlowNode, FlowEdge, FlowNodeKind, FlowEdgeKind } from '../types.js';

export function nodeId(kind: FlowNodeKind, key: string): string { return `${kind}:${key}`; }

export function emptyGraph(repos: { free: string; pro?: string }, generated: string): FlowGraph {
  return { nodes: {}, edges: [], fingerprints: {}, repos, generated };
}

export function addNode(g: FlowGraph, node: FlowNode): void { g.nodes[node.id] = node; }
export function addEdge(g: FlowGraph, edge: FlowEdge): void { g.edges.push(edge); }

export function inbound(g: FlowGraph, id: string, kinds?: FlowEdgeKind[]): FlowEdge[] {
  return g.edges.filter(e => e.to === id && (!kinds || kinds.includes(e.kind)));
}
export function outbound(g: FlowGraph, id: string, kinds?: FlowEdgeKind[]): FlowEdge[] {
  return g.edges.filter(e => e.from === id && (!kinds || kinds.includes(e.kind)));
}
export function nodesByKind(g: FlowGraph, kind: FlowNodeKind): FlowNode[] {
  return Object.values(g.nodes).filter(n => n.kind === kind);
}

export function writeGraph(path: string, g: FlowGraph): void { writeFileSync(path, JSON.stringify(g)); }
export function readGraph(path: string): FlowGraph | null {
  if (!fileExists(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as FlowGraph; } catch { return null; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/graph.test.js`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/flow/graph.ts src/__tests__/graph.test.ts
git commit -m "feat(flow): FlowGraph model, stable node ids, flow.json IO"
```

---

### Task 5: PHP facts → graph nodes/edges adapter

**Files:**
- Create: `src/flow/php-graph.ts`
- Test: `src/__tests__/php-graph.test.ts`

**Interfaces:**
- Consumes: the sidecar JSON shape (Task 1), `graph.ts` helpers (Task 4).
- Produces: `ingestPhpFacts(g: FlowGraph, facts: PhpFacts, repo: 'free'|'pro'): void` — adds function/method/service/hook/template/route nodes and `calls`/`registers`/`fires`/`loads` edges. Resolves `viaService` calls to the bound class's method using `serviceBindings`. Registration callbacks become `registers` edges INTO the callback symbol (this is what marks a method consumed).
- Produces type `PhpFacts` mirroring the sidecar JSON.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/php-graph.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, inbound, nodeId } from '../flow/graph.js';
import { ingestPhpFacts } from '../flow/php-graph.js';

const facts = {
  symbols: [
    { kind: 'function', name: 'sample_helper', class: null, fqn: 'sample_helper', file: 'a.php', line: 1, bodyHash: 'h1', params: ['x'], visibility: null, abstract: false },
    { kind: 'method', name: 'render', class: 'Sample\\Widget', fqn: 'Sample\\Widget::render', file: 'a.php', line: 5, bodyHash: 'h2', params: [], visibility: 'public', abstract: false },
    { kind: 'method', name: 'latest', class: 'Sample\\Widget', fqn: 'Sample\\Widget::latest', file: 'a.php', line: 9, bodyHash: 'h3', params: [], visibility: 'public', abstract: false },
  ],
  calls: [
    { fromFqn: 'Sample\\Widget', toName: 'sample_helper', viaService: null, file: 'a.php', line: 6 },
    { fromFqn: 'Sample\\Widget', toName: 'latest', viaService: 'feed', file: 'a.php', line: 7 },
  ],
  registrations: [{ hook: 'init', callback: 'Sample\\Widget::render', mechanism: 'add_action', file: 'a.php', line: 12 }],
  serviceBindings: [{ id: 'feed', class: 'Sample\\Widget', file: 'a.php', line: 14 }],
  hooksFired: [], templatesLoaded: [], errors: [],
};

test('service-locator call resolves to bound class method; registration marks method consumed', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  ingestPhpFacts(g, facts as any, 'free');
  const latest = nodeId('method', 'Sample\\Widget::latest');
  assert.ok(inbound(g, latest, ['calls']).length >= 1, 'feed->latest resolved to Widget::latest');
  const render = nodeId('method', 'Sample\\Widget::render');
  assert.ok(inbound(g, render, ['registers']).length === 1, 'render consumed via add_action');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/php-graph.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/flow/php-graph.ts`**

```ts
import { addNode, addEdge, nodeId } from './graph.js';
import type { FlowGraph } from '../types.js';

export interface PhpSymbol { kind:'function'|'method'; name:string; class:string|null; fqn:string; file:string; line:number; bodyHash:string; params:string[]; visibility:string|null; abstract:boolean; }
export interface PhpCall { fromFqn:string|null; toName:string; viaService:string|null; file:string; line:number; }
export interface PhpReg { hook:string; callback:string; mechanism:string; file:string; line:number; }
export interface PhpBind { id:string; class:string; file:string; line:number; }
export interface PhpFacts { symbols:PhpSymbol[]; calls:PhpCall[]; registrations:PhpReg[]; serviceBindings:PhpBind[]; hooksFired:{hook:string;file:string;line:number}[]; templatesLoaded:{template:string;argKeys:string[];file:string;line:number}[]; errors:{file:string;message:string}[]; }

export function ingestPhpFacts(g: FlowGraph, facts: PhpFacts, repo: 'free'|'pro'): void {
  // 1. Symbols → function/method nodes (keyed by fqn; meta carries bodyHash for dup).
  const methodByShortName = new Map<string, string[]>(); // short method name -> [fqn]
  for (const s of facts.symbols) {
    const id = nodeId(s.kind, s.fqn);
    addNode(g, { id, kind: s.kind, name: s.fqn, file: s.file, line: s.line, repo,
      meta: { bodyHash: s.bodyHash, params: s.params, class: s.class, visibility: s.visibility, abstract: s.abstract, short: s.name } });
    if (s.kind === 'method') {
      const arr = methodByShortName.get(s.name) ?? []; arr.push(s.fqn); methodByShortName.set(s.name, arr);
    }
  }
  // 2. Service bindings → service nodes + binding edge to class methods.
  const classOfService = new Map<string, string>();
  for (const b of facts.serviceBindings) {
    classOfService.set(b.id, b.class);
    addNode(g, { id: nodeId('service', b.id), kind: 'service', name: b.id, file: b.file, line: b.line, repo, meta: { class: b.class } });
  }
  // 3. Calls → calls edges. Resolve viaService to bound class method.
  for (const c of facts.calls) {
    const from = c.fromFqn ? (nodeIdForFqn(g, c.fromFqn)) : null;
    let toId: string | null = null;
    if (c.viaService) {
      const cls = classOfService.get(c.viaService);
      if (cls && c.toName) toId = nodeId('method', `${cls}::${c.toName}`);
    } else {
      // direct function call, else fall back to a unique method short-name match
      toId = nodeId('function', c.toName);
      if (!g.nodes[toId]) {
        const cands = methodByShortName.get(c.toName);
        if (cands && cands.length === 1) toId = nodeId('method', cands[0]);
      }
    }
    if (toId && g.nodes[toId]) addEdge(g, { from: from ?? toId, to: toId, kind: 'calls', file: c.file, line: c.line });
  }
  // 4. Registrations → registers edge INTO the callback symbol (consumption marker).
  for (const r of facts.registrations) {
    if (!r.callback) continue;
    const cbId = r.callback.includes('::') ? nodeId('method', r.callback) : nodeId('function', r.callback);
    addNode(g, { id: nodeId('hook', r.hook), kind: 'hook', name: r.hook, file: r.file, line: r.line, repo });
    if (g.nodes[cbId]) addEdge(g, { from: nodeId('hook', r.hook), to: cbId, kind: 'registers', file: r.file, line: r.line });
  }
  // 5. Fired hooks → fires edges from hook node (producer side).
  for (const h of facts.hooksFired) {
    addNode(g, { id: nodeId('hook', h.hook), kind: 'hook', name: h.hook, file: h.file, line: h.line, repo });
    addEdge(g, { from: nodeId('hook', h.hook), to: nodeId('hook', h.hook), kind: 'fires', file: h.file, line: h.line });
  }
  // 6. Templates loaded → template nodes + loads edges with argKeys.
  for (const t of facts.templatesLoaded) {
    const tid = nodeId('template', t.template);
    addNode(g, { id: tid, kind: 'template', name: t.template, file: t.file, line: t.line, repo, meta: {} });
    addEdge(g, { from: nodeId('function', '<loader>'), to: tid, kind: 'loads', file: t.file, line: t.line, meta: { argKeys: t.argKeys } });
  }
}

function nodeIdForFqn(g: FlowGraph, fqn: string): string {
  const m = nodeId('method', fqn);
  if (g.nodes[m]) return m;
  return nodeId('function', fqn);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/php-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/flow/php-graph.ts src/__tests__/php-graph.test.ts
git commit -m "feat(flow): ingest PHP facts into graph; resolve service-locator + registrations"
```

---

### Task 6: REST response shapes + JS consumers

**Files:**
- Create: `src/flow/rest-shapes.ts`
- Test: `src/__tests__/rest-shapes.test.ts`

**Interfaces:**
- Consumes: graph helpers; manifest `rest.endpoints` if present (read from `<repo>/audit/manifest.json`).
- Produces:
  - `addRestRoutes(g, repoRoot, repo): void` — adds `route` nodes from `audit/manifest.json` `rest.endpoints` (route id = `route:<METHOD> <path>`), `meta.shapeKeys` extracted by scanning the route's handler file for `rest_ensure_response([...])`/`return array(...)` literal keys (best-effort; empty when dynamic → `meta.shapeUnresolved = true`).
  - `addJsConsumers(g, repoRoot, repo): void` — scans shipped `assets/**/*.js` for `data.<prop>` accesses within 50 lines of a route URL reference; adds `jsConsumer` nodes + `reads` edges to the route node with `meta.prop`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/rest-shapes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractShapeKeys, extractJsReads } from '../flow/rest-shapes.js';

test('extracts literal response shape keys', () => {
  const php = `function cb(){ return rest_ensure_response(array('items'=>$x,'cursor'=>$c)); }`;
  assert.deepEqual(extractShapeKeys(php).sort(), ['cursor', 'items']);
});

test('flags unresolved dynamic shape', () => {
  const php = `function cb(){ $r = build(); return rest_ensure_response($r); }`;
  assert.deepEqual(extractShapeKeys(php), []);
});

test('extracts JS property reads near a route URL', () => {
  const js = `fetch('/buddynext/v1/feed').then(r=>r.json()).then(d=>{ render(d.items); show(d.cursor); });`;
  const reads = extractJsReads(js, '/buddynext/v1/feed');
  assert.deepEqual(reads.sort(), ['cursor', 'items']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/rest-shapes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/flow/rest-shapes.ts`** (export the two pure helpers + the graph-mutating wrappers)

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNode, addEdge, nodeId } from './graph.js';
import { findJsFiles, fileExists, getLineNumber } from '../shared-utils.js';
import type { FlowGraph } from '../types.js';

// Pure: literal response-shape keys from a handler's PHP source.
export function extractShapeKeys(php: string): string[] {
  const keys = new Set<string>();
  const blocks = [...php.matchAll(/rest_ensure_response\s*\(\s*(?:array\s*\(|\[)([\s\S]*?)(?:\)|\])\s*\)/g),
                  ...php.matchAll(/return\s+(?:array\s*\(|\[)([\s\S]*?)(?:\)|\]);/g)];
  for (const b of blocks)
    for (const k of b[1].matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*=>/g)) keys.add(k[1]);
  return [...keys];
}

// Pure: JS property reads (d.<prop>) within 50 lines of a route URL reference.
export function extractJsReads(js: string, routeUrl: string): string[] {
  const idx = js.indexOf(routeUrl);
  if (idx < 0) return [];
  const start = Math.max(0, idx - 2000), end = Math.min(js.length, idx + 4000);
  const window = js.slice(start, end);
  const props = new Set<string>();
  for (const m of window.matchAll(/\b[a-zA-Z_$][\w$]*\.([a-zA-Z_][\w]*)\b/g)) {
    if (!['then','json','catch','map','forEach','length','data','error','message','code'].includes(m[1])) props.add(m[1]);
  }
  return [...props];
}

export function addRestRoutes(g: FlowGraph, repoRoot: string, repo: 'free'|'pro'): void {
  const manifest = join(repoRoot, 'audit', 'manifest.json');
  if (!fileExists(manifest)) return;
  let m: any; try { m = JSON.parse(readFileSync(manifest, 'utf8')); } catch { return; }
  for (const ep of m?.rest?.endpoints ?? []) {
    const method = (ep.methods?.[0] ?? 'GET').replace('READABLE','GET').replace('CREATABLE','POST');
    const id = nodeId('route', `${method} ${ep.route}`);
    let shapeKeys: string[] = []; let unresolved = true;
    const file = (ep.file ?? '').split(':')[0];
    if (file && fileExists(join(repoRoot, file))) {
      const keys = extractShapeKeys(readFileSync(join(repoRoot, file), 'utf8'));
      if (keys.length) { shapeKeys = keys; unresolved = false; }
    }
    addNode(g, { id, kind: 'route', name: `${method} ${ep.route}`, file, line: 0, repo,
      meta: { shapeKeys, shapeUnresolved: unresolved, gatedBy: ep.gated_by ?? null } });
  }
}

export function addJsConsumers(g: FlowGraph, repoRoot: string, repo: 'free'|'pro'): void {
  const routes = Object.values(g.nodes).filter(n => n.kind === 'route');
  for (const f of findJsFiles(join(repoRoot, 'assets'))) {
    let js = ''; try { js = readFileSync(f, 'utf8'); } catch { continue; }
    for (const r of routes) {
      const path = r.name.split(' ')[1];
      const reads = extractJsReads(js, path);
      for (const prop of reads) {
        const cid = nodeId('jsConsumer', `${f}:${r.name}:${prop}`);
        addNode(g, { id: cid, kind: 'jsConsumer', name: prop, file: f, line: getLineNumber(js, js.indexOf(path)), repo, meta: { prop } });
        addEdge(g, { from: cid, to: r.id, kind: 'reads', file: f, line: 0, meta: { prop } });
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/rest-shapes.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/flow/rest-shapes.ts src/__tests__/rest-shapes.test.ts
git commit -m "feat(flow): REST response-shape extraction + JS consumer reads"
```

---

### Task 7: FlowGraph build + incremental entry

**Files:**
- Create: `src/flow/build.ts`
- Test: `src/__tests__/build.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `buildGraph(opts: { freeRoot: string; proRoot?: string; generated: string }): FlowGraph` — full build: resolve scope (free + pro), run PHP sidecar over `includeDirs` of both repos, ingest facts, add REST routes + JS consumers, fingerprint scanned files, return graph. Writes nothing.
- Produces: `buildOrUpdate(opts): FlowGraph` — if `<freeRoot>/audit/flow.json` exists and its fingerprints intersect-clean, reuse; else full rebuild. (Skeleton: incremental reuse only when NO scanned file changed; otherwise full rebuild — documented as the conservative first cut; per-file patching is a later optimization.)

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/build.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../flow/build.js';

test('builds a graph over the BN free repo with routes, functions, templates', () => {
  const g = buildGraph({ freeRoot: '/Users/vapvarun/dev/repos/buddynext', generated: 't' });
  assert.ok(Object.values(g.nodes).some(n => n.kind === 'function'), 'has functions');
  assert.ok(Object.values(g.nodes).some(n => n.kind === 'route'), 'has routes');
  assert.ok(Object.values(g.nodes).some(n => n.kind === 'template'), 'has templates');
  assert.ok(Object.keys(g.fingerprints).length > 100, 'fingerprinted many files');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/build.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/flow/build.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { resolveScanScope } from './scope.js';
import { fingerprintFiles } from './fingerprint.js';
import { emptyGraph, readGraph } from './graph.js';
import { ingestPhpFacts, type PhpFacts } from './php-graph.js';
import { addRestRoutes, addJsConsumers } from './rest-shapes.js';
import { findPhpFiles } from '../shared-utils.js';
import type { FlowGraph } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(here, '..', '..', 'php-ast', 'extract-graph.php'); // build/flow -> repo root

function runSidecar(dirs: string[]): PhpFacts {
  if (dirs.length === 0) return { symbols:[], calls:[], registrations:[], serviceBindings:[], hooksFired:[], templatesLoaded:[], errors:[] };
  const out = execFileSync('php', [SIDECAR, ...dirs], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out) as PhpFacts;
}

export function buildGraph(opts: { freeRoot: string; proRoot?: string; generated: string }): FlowGraph {
  const g = emptyGraph({ free: opts.freeRoot, pro: opts.proRoot }, opts.generated);
  const repos: Array<['free'|'pro', string]> = [['free', opts.freeRoot]];
  if (opts.proRoot) repos.push(['pro', opts.proRoot]);

  const scannedFiles: string[] = [];
  for (const [repo, root] of repos) {
    const { includeDirs } = resolveScanScope(root);
    ingestPhpFacts(g, runSidecar(includeDirs), repo);
    addRestRoutes(g, root, repo);
    addJsConsumers(g, root, repo);
    for (const d of includeDirs) scannedFiles.push(...findPhpFiles(d));
    Object.assign(g.fingerprints, fingerprintFiles(scannedFiles, root));
  }
  return g;
}

export function buildOrUpdate(opts: { freeRoot: string; proRoot?: string; generated: string }): FlowGraph {
  const prior = readGraph(join(opts.freeRoot, 'audit', 'flow.json'));
  if (prior) {
    const next = fingerprintFilesForRepos(opts);
    const changed = Object.entries(next).some(([k, v]) => prior.fingerprints[k] !== v)
      || Object.keys(prior.fingerprints).some(k => !(k in next));
    if (!changed) return prior; // nothing changed → reuse cached graph
  }
  return buildGraph(opts);
}

function fingerprintFilesForRepos(opts: { freeRoot: string; proRoot?: string }): Record<string, string> {
  const all: Record<string, string> = {};
  const repos = [opts.freeRoot, ...(opts.proRoot ? [opts.proRoot] : [])];
  for (const root of repos) {
    const { includeDirs } = resolveScanScope(root);
    const files: string[] = [];
    for (const d of includeDirs) files.push(...findPhpFiles(d));
    Object.assign(all, fingerprintFiles(files, root));
  }
  return all;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/build.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/flow/build.ts src/__tests__/build.test.ts
git commit -m "feat(flow): full + incremental FlowGraph build over the BN pair"
```

---

### Task 8: dup-function-checker

**Files:**
- Create: `src/dup-function-checker.ts`
- Test: `src/__tests__/dup-function.test.ts`

**Interfaces:**
- Consumes: `FlowGraph` (function/method nodes carry `meta.bodyHash`, `meta.class`, `meta.abstract`).
- Produces: `checkDupFunctions(g: FlowGraph): CheckerResult`. Clusters function/method nodes by identical `bodyHash` (size ≥ 2). EXCLUDES clusters where all members are overrides in the same class hierarchy (same `short` method name + abstract base present) — legitimate Free/Pro overrides. Finding id `dup:<bodyHash>`, severity `high`, lists every member `file:line`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/dup-function.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, nodeId } from '../flow/graph.js';
import { checkDupFunctions } from '../dup-function-checker.js';

test('flags two functions with identical body hash', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function','a_initials'), kind:'function', name:'a_initials', file:'a.php', line:1, repo:'free', meta:{ bodyHash:'SAME', short:'a_initials' } });
  addNode(g, { id: nodeId('function','b_initials'), kind:'function', name:'b_initials', file:'b.php', line:1, repo:'free', meta:{ bodyHash:'SAME', short:'b_initials' } });
  addNode(g, { id: nodeId('function','c_unique'), kind:'function', name:'c_unique', file:'c.php', line:1, repo:'free', meta:{ bodyHash:'OTHER', short:'c_unique' } });
  const r = checkDupFunctions(g);
  assert.equal(r.failed, 1, 'one dup cluster');
  assert.match(r.issues[0].message, /a_initials|b_initials/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/dup-function.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/dup-function-checker.ts`**

```ts
import type { CheckerResult, CheckerIssue, FlowGraph, FlowNode } from './types.js';

export function checkDupFunctions(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const byHash = new Map<string, FlowNode[]>();
  for (const n of Object.values(g.nodes)) {
    if (n.kind !== 'function' && n.kind !== 'method') continue;
    const h = (n.meta?.bodyHash as string) || '';
    if (!h) continue;
    const arr = byHash.get(h) ?? []; arr.push(n); byHash.set(h, arr);
  }
  const issues: CheckerIssue[] = [];
  let clusters = 0;
  for (const [hash, members] of byHash) {
    if (members.length < 2) continue;
    // Exclude same-short-name method override families (legitimate Free/Pro override).
    const shorts = new Set(members.map(m => m.meta?.short as string));
    const allMethods = members.every(m => m.kind === 'method');
    if (allMethods && shorts.size === 1) continue;
    clusters++;
    issues.push({
      id: `dup:${hash}`, category: 'dup-function', severity: 'high', type: 'error',
      title: `Duplicate implementation across ${members.length} symbols`,
      message: `Identical body in: ${members.map(m => `${m.name} (${m.file}:${m.line})`).join(', ')}. Consolidate to one canonical helper.`,
      file: members[0].file, line: members[0].line, code: 'duplicate-function',
      fix: `Keep one (recommend the one in the most general location) and route the others through it.`,
    });
  }
  const checked = byHash.size;
  return { category: 'dup-function', issues, passed: Math.max(0, checked - clusters), failed: clusters, skipped: 0, duration: Date.now() - start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/dup-function.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dup-function-checker.ts src/__tests__/dup-function.test.ts
git commit -m "feat(flow): dup-function checker (body-hash clusters, override-aware)"
```

---

### Task 9: orphan-checker (dead code)

**Files:**
- Create: `src/orphan-checker.ts`
- Test: `src/__tests__/orphan.test.ts`

**Interfaces:**
- Consumes: `FlowGraph`.
- Produces: `checkOrphans(g: FlowGraph): CheckerResult`. A function/method/template node is orphan if it has NO inbound edge of kind `calls`, `registers`, `loads`, or `reads`. Public methods named `__construct`/`__invoke` and abstract methods are excluded. Finding id `orphan:<kind>:<name>`, severity `medium` (dead code is removable, not a break).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/orphan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkOrphans } from '../orphan-checker.js';

test('flags an uncalled function but not a registered callback', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('function','dead_fn'), kind:'function', name:'dead_fn', file:'a.php', line:1, repo:'free', meta:{} });
  addNode(g, { id: nodeId('method','X::boot'), kind:'method', name:'X::boot', file:'b.php', line:1, repo:'free', meta:{ short:'boot' } });
  addNode(g, { id: nodeId('hook','init'), kind:'hook', name:'init', file:'b.php', line:1, repo:'free' });
  addEdge(g, { from: nodeId('hook','init'), to: nodeId('method','X::boot'), kind:'registers', file:'b.php', line:1 });
  const r = checkOrphans(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.includes('orphan:function:dead_fn'), 'dead_fn is orphan');
  assert.ok(!ids.some(i => i.includes('X::boot')), 'registered callback not orphan');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/orphan.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/orphan-checker.ts`**

```ts
import { inbound } from './flow/graph.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

const SELF_USED = new Set(['__construct', '__invoke', '__destruct', 'register', 'boot']);

export function checkOrphans(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const targets = Object.values(g.nodes).filter(n => n.kind === 'function' || n.kind === 'method' || n.kind === 'template');
  let orphans = 0;
  for (const n of targets) {
    const short = (n.meta?.short as string) ?? '';
    if (n.meta?.abstract) continue;
    if (n.kind === 'method' && SELF_USED.has(short)) continue;
    const consumed = inbound(g, n.id, ['calls', 'registers', 'loads', 'reads']).length > 0;
    if (consumed) continue;
    orphans++;
    issues.push({
      id: `orphan:${n.kind}:${n.name}`, category: 'orphan', severity: 'medium', type: 'warning',
      title: `${n.kind} ${n.name} is never consumed in the pair`,
      message: `No call / registration / template-load / read references ${n.name} anywhere in free+pro. Candidate dead code.`,
      file: n.file, line: n.line, code: 'orphan-symbol',
      fix: `Remove it, or wire the missing consumer if it was meant to be used.`,
    });
  }
  return { category: 'orphan', issues, passed: Math.max(0, targets.length - orphans), failed: orphans, skipped: 0, duration: Date.now() - start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/orphan.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orphan-checker.ts src/__tests__/orphan.test.ts
git commit -m "feat(flow): orphan/dead-code checker (consumption-registry aware)"
```

---

### Task 10: rest-flow-checker (produced ↔ consumed)

**Files:**
- Create: `src/rest-flow-checker.ts`
- Test: `src/__tests__/rest-flow.test.ts`

**Interfaces:**
- Consumes: `FlowGraph` (`route` nodes with `meta.shapeKeys`/`meta.shapeUnresolved`; `reads` edges from `jsConsumer` with `meta.prop`).
- Produces: `checkRestFlow(g: FlowGraph): CheckerResult`. For each route with a RESOLVED shape: a JS read of a prop NOT in `shapeKeys` → `error` `rest-flow:broken-read:<route>:<prop>` (consumer reads a key the route never returns). A shape key never read by any consumer → `warning` `rest-flow:dead-output:<route>:<key>`. Routes with `shapeUnresolved` emit one `info` `rest-flow:shape-unresolved:<route>` and are skipped for key analysis.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/rest-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, addEdge, nodeId } from '../flow/graph.js';
import { checkRestFlow } from '../rest-flow-checker.js';

test('flags JS read of a key the route never returns, and dead output', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  const rid = nodeId('route','GET /buddynext/v1/feed');
  addNode(g, { id: rid, kind:'route', name:'GET /buddynext/v1/feed', file:'F.php', line:0, repo:'free', meta:{ shapeKeys:['items','cursor'], shapeUnresolved:false } });
  const c = nodeId('jsConsumer','feed.js:GET /buddynext/v1/feed:courses');
  addNode(g, { id:c, kind:'jsConsumer', name:'courses', file:'feed.js', line:3, repo:'free', meta:{ prop:'courses' } });
  addEdge(g, { from:c, to:rid, kind:'reads', file:'feed.js', line:3, meta:{ prop:'courses' } });
  const r = checkRestFlow(g);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.some(i => i.startsWith('rest-flow:broken-read')), 'broken read flagged');
  assert.ok(ids.some(i => i.startsWith('rest-flow:dead-output')), 'unread keys flagged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/rest-flow.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rest-flow-checker.ts`**

```ts
import { inbound } from './flow/graph.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

export function checkRestFlow(g: FlowGraph): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const routes = Object.values(g.nodes).filter(n => n.kind === 'route');
  let checked = 0;
  for (const r of routes) {
    const shapeKeys = (r.meta?.shapeKeys as string[]) ?? [];
    if (r.meta?.shapeUnresolved) {
      issues.push({ id:`rest-flow:shape-unresolved:${r.name}`, category:'rest-flow', severity:'low', type:'info',
        title:`Response shape unresolved for ${r.name}`, message:`Handler returns a dynamic/hydrated shape; key-level flow not checked.`,
        file:r.file, line:0, code:'rest-flow-unresolved', fix:`(no action) or return a literal array to enable key checks.` });
      continue;
    }
    checked++;
    const reads = inbound(g, r.id, ['reads']).map(e => e.meta?.prop as string).filter(Boolean);
    const readSet = new Set(reads);
    for (const prop of readSet) if (!shapeKeys.includes(prop))
      issues.push({ id:`rest-flow:broken-read:${r.name}:${prop}`, category:'rest-flow', severity:'high', type:'error',
        title:`Consumer reads "${prop}" but ${r.name} never returns it`,
        message:`JS reads data.${prop}; route shape is {${shapeKeys.join(', ')}}. Envelope mismatch → blank UI.`,
        file:r.file, line:0, code:'rest-flow-broken-read', fix:`Add "${prop}" to the response or fix the JS key.` });
    for (const key of shapeKeys) if (!readSet.has(key))
      issues.push({ id:`rest-flow:dead-output:${r.name}:${key}`, category:'rest-flow', severity:'low', type:'warning',
        title:`${r.name} returns "${key}" but no consumer reads it`,
        message:`Dead output key; either a consumer is missing or the field can be dropped.`,
        file:r.file, line:0, code:'rest-flow-dead-output', fix:`Wire a consumer or remove the field.` });
  }
  const failed = issues.filter(i => i.type === 'error').length;
  return { category:'rest-flow', issues, passed: Math.max(0, checked - failed), failed, skipped: 0, duration: Date.now() - start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/rest-flow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rest-flow-checker.ts src/__tests__/rest-flow.test.ts
git commit -m "feat(flow): rest-flow checker (broken-read / dead-output / unresolved)"
```

---

### Task 11: canonical-usage-checker (wrong function)

**Files:**
- Create: `src/canonical-usage-checker.ts`
- Create: `src/flow/canonical-rules.ts` (data-driven rules)
- Test: `src/__tests__/canonical-usage.test.ts`

**Interfaces:**
- Consumes: scanned template + PHP files (re-reads files flagged by rules; rules reference the scope from Task 2).
- Produces:
  - `src/flow/canonical-rules.ts`: `export const CANONICAL_RULES: Array<{ id:string; pattern:RegExp; appliesTo:'template'|'php'|'any'; message:string; fix:string }>` — seeded with: raw `$wpdb` in templates, raw `SELECT `/`->get_results(` in templates, `get_posts(`/`new WP_Query` in templates (should be service layer).
  - `checkCanonicalUsage(repoRoots: string[]): CheckerResult` — for each rule, scan the in-scope files of the matching type; each match is a `high` finding id `wrong-fn:<ruleId>:<relfile>:<line>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/canonical-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_RULES } from '../flow/canonical-rules.js';
import { scanForRule } from '../canonical-usage-checker.js';

test('detects raw $wpdb usage in a template string', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'wpdb-in-template')!;
  const hits = scanForRule('global $wpdb; $rows = $wpdb->get_results("SELECT 1");', rule);
  assert.ok(hits.length >= 1, 'flags $wpdb in template');
});

test('clean template yields no hits', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'wpdb-in-template')!;
  assert.equal(scanForRule('<?php echo esc_html($title); ?>', rule).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/canonical-usage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/flow/canonical-rules.ts`**

```ts
export interface CanonicalRule { id: string; pattern: RegExp; appliesTo: 'template'|'php'|'any'; message: string; fix: string; }

export const CANONICAL_RULES: CanonicalRule[] = [
  { id:'wpdb-in-template', pattern:/\$wpdb\b/, appliesTo:'template',
    message:'Raw $wpdb in a template; templates must consume the service layer, not query the DB.',
    fix:'Move the query into a service/hydrator and pass the data in via the loader args.' },
  { id:'rawsql-in-template', pattern:/->get_(results|row|var|col)\s*\(/, appliesTo:'template',
    message:'Raw SQL result call in a template.', fix:'Hydrate in a service and pass results to the template.' },
  { id:'wpquery-in-template', pattern:/\bnew\s+WP_Query\b|\bget_posts\s*\(/, appliesTo:'template',
    message:'Direct query construction in a template.', fix:'Build the query in a service; templates render prepared data.' },
];
```

- [ ] **Step 4: Implement `src/canonical-usage-checker.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveScanScope } from './flow/scope.js';
import { CANONICAL_RULES, type CanonicalRule } from './flow/canonical-rules.js';
import { findPhpFiles, relativePath, getLineNumber, dirExists } from './shared-utils.js';
import type { CheckerResult, CheckerIssue } from './types.js';

export function scanForRule(content: string, rule: CanonicalRule): number[] {
  const lines: number[] = [];
  const re = new RegExp(rule.pattern.source, 'g');
  for (const m of content.matchAll(re)) lines.push(getLineNumber(content, m.index ?? 0));
  return lines;
}

export function checkCanonicalUsage(repoRoots: string[]): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  let scanned = 0;
  for (const root of repoRoots) {
    const { includeDirs } = resolveScanScope(root);
    const tplDir = join(root, 'templates');
    const tplFiles = dirExists(tplDir) ? findPhpFiles(tplDir) : [];
    const allPhp: string[] = [];
    for (const d of includeDirs) allPhp.push(...findPhpFiles(d));
    for (const f of allPhp) {
      const isTpl = tplFiles.includes(f);
      let content = ''; try { content = readFileSync(f, 'utf8'); } catch { continue; }
      scanned++;
      for (const rule of CANONICAL_RULES) {
        if (rule.appliesTo === 'template' && !isTpl) continue;
        if (rule.appliesTo === 'php' && isTpl) continue;
        for (const line of scanForRule(content, rule)) {
          const rel = relativePath(f, root);
          issues.push({ id:`wrong-fn:${rule.id}:${rel}:${line}`, category:'canonical-usage', severity:'high', type:'error',
            title:`Wrong-layer usage: ${rule.id}`, message:rule.message, file:rel, line, code:'canonical-usage-violation', fix:rule.fix });
        }
      }
    }
  }
  const failed = issues.length;
  return { category:'canonical-usage', issues, passed: Math.max(0, scanned - failed), failed, skipped: 0, duration: Date.now() - start };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/canonical-usage.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/canonical-usage-checker.ts src/flow/canonical-rules.ts src/__tests__/canonical-usage.test.ts
git commit -m "feat(flow): canonical-usage checker (service-layer bypass / raw SQL in templates)"
```

---

### Task 12: template-usage-checker

**Files:**
- Create: `src/template-usage-checker.ts`
- Test: `src/__tests__/template-usage.test.ts`

**Interfaces:**
- Consumes: `FlowGraph` (`template` nodes; `loads` edges with `meta.argKeys`); the filesystem list of `templates/**/*.php` per repo (to find never-loaded templates).
- Produces: `checkTemplateUsage(g: FlowGraph, repoRoots: string[]): CheckerResult`. A template file on disk with NO inbound `loads` edge → `warning` `tpl-usage:never-loaded:<relfile>` (excluding top-level page templates `templates/*.php` and `templates/<route>/` entrypoints, which WP/router loads directly — list-driven exclusion `ENTRYPOINT_DIRS`). Reports a usage map summary as `info`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/template-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEntrypoint } from '../template-usage-checker.js';

test('parts are not entrypoints; top-level page templates are', () => {
  assert.equal(isEntrypoint('templates/parts/post-card.php'), false);
  assert.equal(isEntrypoint('templates/feed/home.php'), true);
  assert.equal(isEntrypoint('templates/members.php'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/template-usage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/template-usage-checker.ts`**

```ts
import { join } from 'node:path';
import { inbound } from './flow/graph.js';
import { findPhpFiles, relativePath, dirExists } from './shared-utils.js';
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

// Entrypoint = a top-level page template or a route-folder home, loaded by the router/WP directly.
const PARTS_DIRS = ['/parts/', '/partials/', '/blocks/'];
export function isEntrypoint(rel: string): boolean {
  if (PARTS_DIRS.some(d => rel.includes(d))) return false;
  const inTemplates = rel.replace(/^.*templates\//, '');
  return inTemplates.split('/').length <= 2; // templates/foo.php or templates/route/home.php
}

export function checkTemplateUsage(g: FlowGraph, repoRoots: string[]): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  // Set of loaded template names (graph node name == relative template path passed to loader).
  const loaded = new Set(Object.values(g.nodes).filter(n => n.kind === 'template' && inbound(g, n.id, ['loads']).length > 0).map(n => n.name));
  let checked = 0, orphaned = 0;
  for (const root of repoRoots) {
    const tplDir = join(root, 'templates');
    if (!dirExists(tplDir)) continue;
    for (const f of findPhpFiles(tplDir)) {
      const rel = relativePath(f, root);
      const nameForLoader = rel.replace(/^templates\//, '');
      checked++;
      if (isEntrypoint(rel)) continue;
      const isLoaded = [...loaded].some(l => l === nameForLoader || l.endsWith('/' + nameForLoader) || nameForLoader.endsWith(l));
      if (!isLoaded) {
        orphaned++;
        issues.push({ id:`tpl-usage:never-loaded:${rel}`, category:'template-usage', severity:'medium', type:'warning',
          title:`Template ${rel} is never loaded`, message:`No buddynext_get_template() call references this part. Candidate dead template.`,
          file:rel, line:1, code:'template-never-loaded', fix:`Load it from the right place, or delete it.` });
      }
    }
  }
  return { category:'template-usage', issues, passed: Math.max(0, checked - orphaned), failed: 0 /* warnings only */, skipped: 0, duration: Date.now() - start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/template-usage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/template-usage-checker.ts src/__tests__/template-usage.test.ts
git commit -m "feat(flow): template-usage checker (never-loaded parts, entrypoint-aware)"
```

---

### Task 13: logic-flow descriptor emitter

**Files:**
- Create: `src/logic-flow-checker.ts`
- Test: `src/__tests__/logic-flow.test.ts`

**Interfaces:**
- Consumes: `FlowGraph`; `<freeRoot>/audit/journeys.json` (array of `{ id, name, entry }` where `entry` is a route path or page slug).
- Produces: `checkLogicFlow(g: FlowGraph, journeys: Array<{id:string;name:string;entry:string}>): CheckerResult`. For each journey, resolve `entry` to a graph node (route by path match). If no node resolves → `warning` `logic-flow:no-path:<journeyId>` (documented journey with no implementing entry → coverage gap). Routes present in graph but absent from any journey entry → `info` `logic-flow:undocumented:<route>`. (Runtime correctness is confirmed later by cert oracles, out of scope here.)

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/logic-flow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph, addNode, nodeId } from '../flow/graph.js';
import { checkLogicFlow } from '../logic-flow-checker.js';

test('flags a journey whose entry has no graph route', () => {
  const g = emptyGraph({ free: '/free' }, 't');
  addNode(g, { id: nodeId('route','GET /buddynext/v1/feed'), kind:'route', name:'GET /buddynext/v1/feed', file:'F.php', line:0, repo:'free', meta:{} });
  const journeys = [{ id:'jJoin', name:'Join a space', entry:'/buddynext/v1/spaces/join' }, { id:'jFeed', name:'View feed', entry:'/buddynext/v1/feed' }];
  const r = checkLogicFlow(g, journeys);
  const ids = r.issues.map(i => i.id);
  assert.ok(ids.includes('logic-flow:no-path:jJoin'), 'join journey unresolved');
  assert.ok(!ids.includes('logic-flow:no-path:jFeed'), 'feed journey resolved');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test build/__tests__/logic-flow.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/logic-flow-checker.ts`**

```ts
import type { CheckerResult, CheckerIssue, FlowGraph } from './types.js';

export function checkLogicFlow(g: FlowGraph, journeys: Array<{id:string;name:string;entry:string}>): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];
  const routePaths = Object.values(g.nodes).filter(n => n.kind === 'route').map(n => n.name.split(' ')[1]);
  const matched = new Set<string>();
  for (const j of journeys) {
    const hit = routePaths.find(p => p === j.entry || p.startsWith(j.entry) || j.entry.startsWith(p));
    if (hit) { matched.add(hit); continue; }
    issues.push({ id:`logic-flow:no-path:${j.id}`, category:'logic-flow', severity:'medium', type:'warning',
      title:`Journey "${j.name}" has no implementing entry`, message:`journeys.json entry ${j.entry} resolves to no route in the graph. Coverage gap or stale journey.`,
      file:'audit/journeys.json', line:0, code:'logic-flow-no-path', fix:`Implement the entry, or update/remove the journey.` });
  }
  for (const p of routePaths) if (!matched.has(p))
    issues.push({ id:`logic-flow:undocumented:${p}`, category:'logic-flow', severity:'low', type:'info',
      title:`Route ${p} is in no documented journey`, message:`Consider adding a journey + cert oracle for go-live coverage.`,
      file:'', line:0, code:'logic-flow-undocumented', fix:`Add to journeys.json if user-facing.` });
  const failed = 0; // warnings/info only
  return { category:'logic-flow', issues, passed: matched.size, failed, skipped: 0, duration: Date.now() - start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test build/__tests__/logic-flow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic-flow-checker.ts src/__tests__/logic-flow.test.ts
git commit -m "feat(flow): logic-flow descriptor emitter (journeys.json coverage)"
```

---

### Task 14: Baseline, report renderer, runner + CLI

**Files:**
- Create: `src/flow/baseline.ts`
- Create: `src/flow/report.ts`
- Create: `src/flow-audit.ts`
- Create: `src/flow-audit-cli.ts`
- Test: `src/__tests__/baseline.test.ts`, `src/__tests__/report.test.ts`

**Interfaces:**
- `baseline.ts`: `applyBaseline(issues: CheckerIssue[], baseline: {suppressions:{id:string}[]}): CheckerIssue[]` (drops suppressed ids); `loadBaseline(path): {suppressions:{id:string;reason:string}[]}`.
- `report.ts`: `renderReport(results: CheckerResult[], meta:{generated:string; repos:string[]}): string` (markdown grouped by category, severity-sorted, counts).
- `flow-audit.ts`: `runFlowAudit(opts:{freeRoot:string; proRoot?:string; generated:string}): { results: CheckerResult[]; report: string; errorCount: number }` — builds graph (Task 7), runs all 6 new checkers + the 2 existing (`checkTemplateContracts`, `rest-js`), applies baseline from `<freeRoot>/audit/.flow-audit-baseline.json`, returns aggregate + rendered report. Writes `audit/flow.json` and `audit/flow-audit-report.md`.
- `flow-audit-cli.ts`: reads `process.argv` `[freeRoot, proRoot?]`, calls `runFlowAudit`, writes artifacts, prints summary, exits 1 if `errorCount > 0`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/baseline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseline } from '../flow/baseline.js';
test('drops suppressed ids', () => {
  const issues = [{ id:'dup:AAA' }, { id:'orphan:function:x' }] as any;
  const kept = applyBaseline(issues, { suppressions: [{ id:'dup:AAA', reason:'verified intentional' }] });
  assert.deepEqual(kept.map((i:any)=>i.id), ['orphan:function:x']);
});
```

```ts
// src/__tests__/report.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../flow/report.js';
test('renders grouped markdown with counts', () => {
  const md = renderReport([{ category:'dup-function', issues:[{ id:'dup:A', severity:'high', type:'error', title:'Duplicate', message:'m', file:'a.php', line:1 } as any], passed:5, failed:1, skipped:0, duration:1 }], { generated:'t', repos:['free'] });
  assert.match(md, /dup-function/);
  assert.match(md, /Duplicate/);
  assert.match(md, /1 error|failed/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test build/__tests__/baseline.test.js build/__tests__/report.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/flow/baseline.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileExists } from '../shared-utils.js';
import type { CheckerIssue } from '../types.js';

export interface FlowBaseline { suppressions: { id: string; reason: string }[]; }

export function loadBaseline(path: string): FlowBaseline {
  if (!fileExists(path)) return { suppressions: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')) as FlowBaseline; } catch { return { suppressions: [] }; }
}
export function applyBaseline(issues: CheckerIssue[], baseline: { suppressions: { id: string }[] }): CheckerIssue[] {
  const sup = new Set(baseline.suppressions.map(s => s.id));
  return issues.filter(i => !sup.has(i.id));
}
```

- [ ] **Step 4: Implement `src/flow/report.ts`**

```ts
import type { CheckerResult } from '../types.js';
const ORDER = { error: 0, warning: 1, info: 2 } as const;

export function renderReport(results: CheckerResult[], meta: { generated: string; repos: string[] }): string {
  const lines: string[] = [];
  lines.push(`# Flow Audit Report`, ``, `- Generated: ${meta.generated}`, `- Repos: ${meta.repos.join(', ')}`, ``);
  const totalErr = results.reduce((a, r) => a + r.issues.filter(i => i.type === 'error').length, 0);
  const totalWarn = results.reduce((a, r) => a + r.issues.filter(i => i.type === 'warning').length, 0);
  lines.push(`**${totalErr} errors, ${totalWarn} warnings** across ${results.length} checks.`, ``);
  for (const r of results) {
    const errs = r.issues.filter(i => i.type === 'error').length;
    lines.push(`## ${r.category} — ${errs} error(s), ${r.issues.length} finding(s)`, ``);
    const sorted = [...r.issues].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
    for (const i of sorted) {
      lines.push(`- [${i.type}] **${i.title}** \`${i.file}:${i.line}\``);
      lines.push(`  - ${i.message}`);
      if (i.fix) lines.push(`  - _Fix:_ ${i.fix}`);
      lines.push(`  - _id:_ \`${i.id}\``);
    }
    lines.push(``);
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Implement `src/flow-audit.ts`**

```ts
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { buildGraph } from './flow/build.js';
import { writeGraph } from './flow/graph.js';
import { checkDupFunctions } from './dup-function-checker.js';
import { checkOrphans } from './orphan-checker.js';
import { checkRestFlow } from './rest-flow-checker.js';
import { checkCanonicalUsage } from './canonical-usage-checker.js';
import { checkTemplateUsage } from './template-usage-checker.js';
import { checkLogicFlow } from './logic-flow-checker.js';
import { checkTemplateContracts } from './template-contract-checker.js';
import { loadBaseline, applyBaseline } from './flow/baseline.js';
import { renderReport } from './flow/report.js';
import { fileExists } from './shared-utils.js';
import type { CheckerResult } from './types.js';

export function runFlowAudit(opts: { freeRoot: string; proRoot?: string; generated: string }):
  { results: CheckerResult[]; report: string; errorCount: number } {
  const g = buildGraph(opts);
  const repoRoots = [opts.freeRoot, ...(opts.proRoot ? [opts.proRoot] : [])];

  let journeys: Array<{ id: string; name: string; entry: string }> = [];
  const jp = join(opts.freeRoot, 'audit', 'journeys.json');
  if (fileExists(jp)) { try { journeys = JSON.parse(readFileSync(jp, 'utf8')); } catch { /* ignore */ } }

  const results: CheckerResult[] = [
    checkDupFunctions(g),
    checkOrphans(g),
    checkRestFlow(g),
    checkCanonicalUsage(repoRoots),
    checkTemplateUsage(g, repoRoots),
    checkLogicFlow(g, Array.isArray(journeys) ? journeys : (journeys as any).journeys ?? []),
    checkTemplateContracts(opts.freeRoot),
  ];

  const baseline = loadBaseline(join(opts.freeRoot, 'audit', '.flow-audit-baseline.json'));
  for (const r of results) r.issues = applyBaseline(r.issues, baseline);

  const report = renderReport(results, { generated: opts.generated, repos: repoRoots });
  writeGraph(join(opts.freeRoot, 'audit', 'flow.json'), g);
  writeFileSync(join(opts.freeRoot, 'audit', 'flow-audit-report.md'), report);
  const errorCount = results.reduce((a, r) => a + r.issues.filter(i => i.type === 'error').length, 0);
  return { results, report, errorCount };
}
```

- [ ] **Step 6: Implement `src/flow-audit-cli.ts`**

```ts
#!/usr/bin/env node
import { runFlowAudit } from './flow-audit.js';

const [freeRoot, proRoot] = process.argv.slice(2);
if (!freeRoot) { console.error('usage: flow-audit-cli <freeRoot> [proRoot]'); process.exit(2); }
const generated = new Date().toISOString();
const { results, errorCount } = runFlowAudit({ freeRoot, proRoot, generated });
for (const r of results) console.log(`${r.category}: ${r.issues.filter(i=>i.type==='error').length} err / ${r.issues.length} findings`);
console.log(`\nTotal errors: ${errorCount}. Report: ${freeRoot}/audit/flow-audit-report.md`);
process.exit(errorCount > 0 ? 1 : 0);
```

- [ ] **Step 7: Run tests to verify pass**

Run: `npm run build && node --test build/__tests__/baseline.test.js build/__tests__/report.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/flow/baseline.ts src/flow/report.ts src/flow-audit.ts src/flow-audit-cli.ts src/__tests__/baseline.test.ts src/__tests__/report.test.ts
git commit -m "feat(flow): baseline, report renderer, runner + CLI entry"
```

---

### Task 15: Run on the BN pair, triage, ship the go-live report

**Files:**
- Modify (data only): `/Users/vapvarun/dev/repos/buddynext/audit/.flow-audit-baseline.json` (triaged exceptions)
- Produces: `/Users/vapvarun/dev/repos/buddynext/audit/flow.json`, `/Users/vapvarun/dev/repos/buddynext/audit/flow-audit-report.md`

**Interfaces:** none (execution task).

- [ ] **Step 1: Run the full audit on the pair**

Run: `npm run build && node build/flow-audit-cli.js /Users/vapvarun/dev/repos/buddynext /Users/vapvarun/dev/repos/buddynext-pro`
Expected: per-category counts + a written `flow-audit-report.md`. First run WILL mix real bugs with noise — this is expected.

- [ ] **Step 2: Triage every `error`-level finding**

For each `error` finding, classify as (a) real defect → fix in the plugin repo, or (b) verified-intentional → add `{ id, reason }` to `audit/.flow-audit-baseline.json` with a REAL reason (never a TODO). Do NOT bulk-baseline. Prioritise: `rest-flow:broken-read` (blank-UI bugs), `dup-function` (consolidate), `canonical-usage` (raw SQL in templates).

- [ ] **Step 3: Spot-verify 3 findings per category against source**

Read the cited `file:line` for 3 findings in each category to confirm the checker is accurate (catch any new false-positive class the way the template-contract 260→0 pass did). Fix the checker if a systematic false positive appears; re-run.

- [ ] **Step 4: Re-run until the gate is honest**

Run: `node build/flow-audit-cli.js /Users/vapvarun/dev/repos/buddynext /Users/vapvarun/dev/repos/buddynext-pro`
Expected: exit 0 (every remaining `error` is either fixed or baselined with a reason).

- [ ] **Step 5: Commit the audit artifacts + baseline (in the plugin repo)**

```bash
cd /Users/vapvarun/dev/repos/buddynext
git add audit/flow.json audit/flow-audit-report.md audit/.flow-audit-baseline.json
git commit -m "audit: flow-audit go-live report + triaged baseline for the BN pair"
```

- [ ] **Step 6: Commit any plugin fixes**

Commit real defect fixes discovered during triage as their own focused commits in the affected repo (free or pro), each describing the flow-audit finding it resolves.

---

## Self-Review

**Spec coverage:**
- FlowGraph backbone → Tasks 4–7. PHP-AST sidecar → Task 1. Distribution scope → Task 2. Incremental cache → Tasks 3, 7. dup → 8, orphan → 9, rest-flow → 10, canonical-usage → 11, template-usage → 12, logic-flow → 13, existing template-contract folded in → 14. Runner/report/baseline/gate → 14. Run on BN + triage → 15. Reuse journeys.json → 13/14. Stable IDs → every checker uses content-derived ids. libs/vendor as targets-only → Task 2 + checkers operate on graph/scope. All spec sections covered.

**Placeholder scan:** No "TBD/TODO" in code steps; every code step ships real code; Task 15 is explicitly an execution task with concrete commands.

**Type consistency:** `FlowGraph`/`FlowNode`/`FlowEdge` defined in Task 4, consumed unchanged in 5–14. `CheckerResult`/`CheckerIssue` are the existing `types.ts` shapes. `nodeId`, `inbound`, `outbound`, `nodesByKind`, `addNode`, `addEdge` signatures consistent across tasks. `runFlowAudit`/`buildGraph` signatures match between Task 7, 14, 15.

**Known limitation (documented):** Task 7's `buildOrUpdate` does full-rebuild-on-any-change (conservative first cut); per-file graph patching is a later optimization, not required for the go-live pass.
