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
