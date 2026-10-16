<?php
namespace Sample;

function sample_helper(string $x): string { return strtoupper($x); }

class Widget {
    public function render(): string {
        $s = sample_helper('hi');
        $feed = buddynext_service('feed')->latest();
        $late = $this->latest();          // $this->method() — should emit this->latest
        return $s . $feed . $late;
    }
    public function latest(): string { return 'latest'; }
    public static function helper(): string {
        Widget::helper();                // self static call — should emit Widget::helper
        return 'help';
    }
}

add_action('init', [Widget::class, 'render']);
// service container binding shape used by BuddyNext:
$services['feed'] = static fn() => new Widget();
