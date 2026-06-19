<?php
declare(strict_types=1);
// Emit raw PHP facts (symbols/calls/registrations/service bindings/hooks/templates) as JSON.
// Usage: php extract-graph.php <dir> [<dir> ...]
// Suppress display_errors so extension-load warnings don't pollute JSON stdout.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
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
