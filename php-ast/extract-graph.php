<?php
declare(strict_types=1);
// Emit raw PHP facts (symbols/calls/registrations/service bindings/hooks/templates) as JSON.
// Usage: php extract-graph.php <dir-or-file> [<dir-or-file> ...]
// Each argument may be a directory (scanned recursively) or a single .php file.
// Suppress display_errors so extension-load warnings don't pollute JSON stdout.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
require __DIR__ . '/vendor/autoload.php';

use PhpParser\{ParserFactory, Node, PrettyPrinter, NodeTraverser, NodeVisitorAbstract};
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\Node\Stmt\{Function_, ClassMethod, Class_};
use PhpParser\Node\Expr\{FuncCall, MethodCall, StaticCall};

$rawArgs = array_slice($argv, 1);
// Optional leading --root=<abs> sets the base for rel() for ALL subsequent dir/file args.
$rootBase = null;
if (count($rawArgs) > 0 && str_starts_with($rawArgs[0], '--root=')) {
    $rootBase = rtrim(substr($rawArgs[0], strlen('--root=')), '/');
    $rawArgs = array_slice($rawArgs, 1);
}
$args = $rawArgs;
$parser  = (new ParserFactory())->createForNewestSupportedVersion();
$printer = new PrettyPrinter\Standard();
$out =['symbols'=>[], 'calls'=>[], 'registrations'=>[], 'serviceBindings'=>[],
        'hooksFired'=>[], 'templatesLoaded'=>[], 'errors'=>[], 'referencedNames'=>[]];

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

// Process a single PHP file. $base is used for computing the relative path.
function processPhpFile(string $abs, string $base, array &$out, $parser, $printer): void {
    $relf = rel($abs, $base);
    try { $ast = $parser->parse(file_get_contents($abs)); }
    catch (\Throwable $e) { $out['errors'][] = ['file'=>$relf, 'message'=>$e->getMessage()]; return; }
    if ($ast === null) return;

    $visitor = new class($out, $relf, $printer) extends NodeVisitorAbstract {
        /** @var array<string,true> */
    private array $refNames = [];
    public function __construct(public array &$out, public string $relf, public $printer, public string $ns='', public ?string $cls=null, public ?string $fnFqn=null) {}
    private function addRef(string $name): void { $this->refNames[$name] = true; }
    public function getRefNames(): array { return array_keys($this->refNames); }
        public function enterNode(Node $n) {
            if ($n instanceof Node\Stmt\Namespace_) $this->ns = $n->name ? $n->name->toString() : '';
            if ($n instanceof Class_ && $n->name) $this->cls = ($this->ns ? $this->ns.'\\' : '').$n->name->toString();
            if ($n instanceof Function_) {
                $fqn = ($this->ns?$this->ns.'\\':'').$n->name->toString();
                $body = $this->printer->prettyPrint($n->stmts ?? []);
                $this->out['symbols'][] = ['kind'=>'function','name'=>$n->name->toString(),
                    'class'=>null,'fqn'=>$fqn,
                    'file'=>$this->relf,'line'=>$n->getStartLine(),
                    'bodyHash'=>sha1($body),'bodyLen'=>strlen($body),
                    'params'=>array_map(fn($p)=>$p->var->name ?? '', $n->params),'visibility'=>null,'abstract'=>false];
                $this->fnFqn = $fqn;
            }
            if ($n instanceof ClassMethod && $this->cls) {
                $fqn = $this->cls.'::'.$n->name->toString();
                $body = $this->printer->prettyPrint($n->stmts ?? []);
                $this->out['symbols'][] = ['kind'=>'method','name'=>$n->name->toString(),
                    'class'=>$this->cls,'fqn'=>$fqn,
                    'file'=>$this->relf,'line'=>$n->getStartLine(),
                    'bodyHash'=>sha1($body),'bodyLen'=>strlen($body),
                    'params'=>array_map(fn($p)=>$p->var->name ?? '', $n->params),
                    'visibility'=>$n->isPublic()?'public':($n->isProtected()?'protected':'private'),
                    'abstract'=>$n->isAbstract()];
                $this->fnFqn = $fqn;
            }
            $fromFqn = $this->fnFqn; // enclosing function/method FQN
            if ($n instanceof FuncCall && $n->name instanceof Node\Name) {
                $callName = $n->name->toString();
                $this->addRef($callName);
                $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$callName,'viaService'=>null,
                    'file'=>$this->relf,'line'=>$n->getStartLine()];
                $fn = $n->name->toString();
                if (in_array($fn, ['add_action','add_filter'], true) && isset($n->args[0],$n->args[1])) {
                    $hook = self::s($n->args[0]->value);
                    $cbArg = $n->args[1]->value;
                    $cb = null;
                    // Resolve [$this, 'method'] → 'CurrentClass::method' using enclosing class
                    if ($cbArg instanceof Node\Expr\Array_ && count($cbArg->items) === 2) {
                        $firstEl = $cbArg->items[0]->value;
                        $isThis = $firstEl instanceof Node\Expr\Variable && $firstEl->name === 'this';
                        $methStr = self::s($cbArg->items[1]->value);
                        if ($isThis && $methStr !== null && $this->cls !== null) {
                            $cb = $this->cls . '::' . $methStr;
                        } else {
                            $cb = self::cb($cbArg);
                        }
                        if ($methStr !== null && preg_match('/^[a-zA-Z_]\w*$/', $methStr)) $this->addRef($methStr);
                    } else {
                        $cb = self::cb($cbArg);
                        // Collect string-literal callbacks
                        $cbStr = self::s($cbArg);
                        if ($cbStr !== null && preg_match('/^[a-zA-Z_]\w*$/', $cbStr)) $this->addRef($cbStr);
                    }
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
                if ($m !== null) $this->addRef($m);
                if ($sid!==null) $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$m??'','viaService'=>$sid,'file'=>$this->relf,'line'=>$n->getStartLine()];
            }
            // $this->method() — precise resolution when inside a class
            elseif ($n instanceof MethodCall && $n->var instanceof Node\Expr\Variable
                && $n->var->name === 'this' && $this->cls !== null
                && $n->name instanceof Node\Identifier) {
                $mName = $n->name->toString();
                $this->addRef($mName);
                $toName = $this->cls . '::' . $mName;
                $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$toName,'viaService'=>null,'file'=>$this->relf,'line'=>$n->getStartLine()];
            }
            // General $obj->method() — bare method name, best-effort resolution downstream
            elseif ($n instanceof MethodCall && $n->name instanceof Node\Identifier) {
                $mName = $n->name->toString();
                $this->addRef($mName);
                $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$mName,'viaService'=>null,'file'=>$this->relf,'line'=>$n->getStartLine()];
            }
            // StaticCall: self::method() / static::method() — resolve to enclosing class
            if ($n instanceof StaticCall && $n->name instanceof Node\Identifier
                && $n->class instanceof Node\Name
                && in_array($n->class->toString(), ['self','static'], true)
                && $this->cls !== null) {
                $mName = $n->name->toString();
                $this->addRef($mName);
                $toName = $this->cls . '::' . $mName;
                $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$toName,'viaService'=>null,'file'=>$this->relf,'line'=>$n->getStartLine()];
            }
            // StaticCall: ClassName::method() — best-effort (aliased/short name)
            elseif ($n instanceof StaticCall && $n->name instanceof Node\Identifier
                && $n->class instanceof Node\Name
                && !in_array($n->class->toString(), ['self','static','parent'], true)) {
                $mName = $n->name->toString();
                $this->addRef($mName);
                $toName = $n->class->toString() . '::' . $mName;
                $this->out['calls'][] = ['fromFqn'=>$fromFqn,'toName'=>$toName,'viaService'=>null,'file'=>$this->relf,'line'=>$n->getStartLine()];
            }
            // Service binding: $services['id'] = ... new Class / fn()=>new Class
            if ($n instanceof Node\Expr\Assign && $n->var instanceof Node\Expr\ArrayDimFetch
                && $n->var->var instanceof Node\Expr\Variable && $n->var->var->name==='services') {
                $sid = self::s($n->var->dim);
                $clsName = self::firstNewClass($n->expr);
                if ($sid!==null && $clsName!==null) $this->out['serviceBindings'][] = ['id'=>$sid,'class'=>$clsName,'file'=>$this->relf,'line'=>$n->getStartLine()];
            }
            // Collect any string literal that looks like an identifier (e.g. 'my_callback') — safe over-collection
            if ($n instanceof Node\Scalar\String_ && preg_match('/^[a-zA-Z_]\w*$/', $n->value)) {
                $this->addRef($n->value);
            }
            return null;
        }
        public function leaveNode(Node $n) {
            if ($n instanceof Function_ || $n instanceof ClassMethod) $this->fnFqn = null;
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
    $trav = new NodeTraverser(); $trav->addVisitor(new NameResolver()); $trav->addVisitor($visitor); $trav->traverse($ast);
    // Merge this file's referenced names into the global set
    foreach ($visitor->getRefNames() as $name) { $out['referencedNames'][$name] = true; }
}

foreach ($args as $entry) {
    $entry = rtrim($entry, '/');
    if (is_file($entry)) {
        // Single PHP file passed directly — process just this one file.
        if (pathinfo($entry, PATHINFO_EXTENSION) === 'php') {
            $base = $rootBase !== null ? $rootBase : dirname($entry);
            processPhpFile($entry, $base, $out, $parser, $printer);
        }
        continue;
    }
    // Directory — scan recursively.
    $base = $rootBase !== null ? $rootBase : $entry;
    $rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($entry, FilesystemIterator::SKIP_DOTS));
    foreach ($rii as $f) {
        if ($f->getExtension() !== 'php') continue;
        processPhpFile($f->getPathname(), $base, $out, $parser, $printer);
    }
}
$refKeys = array_keys($out['referencedNames']);
sort($refKeys);
$out['referencedNames'] = $refKeys;
echo json_encode($out);
