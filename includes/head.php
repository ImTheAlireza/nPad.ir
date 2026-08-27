<?php
/**
 * Document head.
 *
 * Expects: $lang, $strings, $pageTitle, $pageDesc, $canonicalPath,
 *          $bodyClass (optional), $includeAppJs (optional bool)
 */

declare(strict_types=1);

// Not a standalone endpoint: refuse direct requests.
if (!defined('NPAD_ROOT')) {
    http_response_code(404);
    exit;
}

$dir            = NPAD_LANGS[$lang]['dir'];
$locale         = NPAD_LANGS[$lang]['locale'];
$canonicalPath  = $canonicalPath ?? '/';
$includeAppJs   = $includeAppJs ?? false;
$altLang        = $lang === 'en' ? 'fa' : 'en';
// Pages without an editing surface (privacy, 404) pass their own target so
// the link never points at an element that does not exist there.
$skipTarget     = $skipTarget ?? '#editor';

// Social-share metadata. Landing pages set $ogTitle/$ogDesc so each URL
// shares its own card; the app pages fall back to the global marketing copy.
// Titles reuse the page <title> when no dedicated OG title is supplied, and
// descriptions reuse the meta description — never the generic homepage blurb.
$ogTitle        = $ogTitle ?? t('meta.og_title');
$ogDesc         = $ogDesc  ?? t('meta.og_desc');
$twitterTitle   = $ogTitle;
$twitterDesc    = $ogDesc;
?>
<!DOCTYPE html>
<html lang="<?= e($lang) ?>" dir="<?= e($dir) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

<title><?= e($pageTitle) ?></title>
<meta name="description" content="<?= e($pageDesc) ?>">
<meta name="theme-color" content="#eef1f5">
<meta name="color-scheme" content="light dark">

<link rel="canonical" href="<?= e(npad_url($canonicalPath)) ?>">
<?php
// hreflang alternates mirror the canonical URL in the other locale, so
// landing pages point at their own translation, not at the home page.
$enAlt = $lang === 'fa' ? str_replace('/fa/', '/', $canonicalPath) : $canonicalPath;
$faAlt = $lang === 'fa' ? $canonicalPath
    : ($canonicalPath === '/' ? '/fa/' : '/fa' . $canonicalPath);
?>
<link rel="alternate" hreflang="en" href="<?= e(npad_url($enAlt)) ?>">
<link rel="alternate" hreflang="fa" href="<?= e(npad_url($faAlt)) ?>">
<link rel="alternate" hreflang="x-default" href="<?= e(npad_url($enAlt)) ?>">

<meta property="og:type" content="website">
<meta property="og:site_name" content="NPad">
<meta property="og:locale" content="<?= e($locale) ?>">
<meta property="og:url" content="<?= e(npad_url($canonicalPath)) ?>">
<meta property="og:title" content="<?= e($ogTitle) ?>">
<meta property="og:description" content="<?= e($ogDesc) ?>">
<meta property="og:image" content="<?= e(npad_url('/og-image.png')) ?>">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="<?= e($ogTitle) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= e($twitterTitle) ?>">
<meta name="twitter:description" content="<?= e($twitterDesc) ?>">
<meta name="twitter:image" content="<?= e(npad_url('/og-image.png')) ?>">

<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">

<?php
/**
 * Set the theme before first paint.
 *
 * The previous build applied dark mode inside DOMContentLoaded, so every
 * dark-mode visitor saw a white flash on each navigation. This must stay
 * inline and synchronous — an external file would still paint first.
 */
?>
<script>
(function () {
    try {
        var stored = localStorage.getItem('npad:theme');
        var dark = stored ? stored === 'dark'
            : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (dark) {
            document.documentElement.dataset.theme = 'dark';
            var m = document.querySelector('meta[name="theme-color"]');
            if (m) m.setAttribute('content', '#0b1120');
        }
    } catch (e) {}
})();
</script>

<?php
// Preload the fonts actually used by this language only — both weights,
// since headings and toolbar labels render with the 600 face above the fold.
if ($lang === 'fa'): ?>
<link rel="preload" href="/fonts/vazirmatn-arabic-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/vazirmatn-arabic-600.woff2" as="font" type="font/woff2" crossorigin>
<?php else: ?>
<link rel="preload" href="/fonts/inter-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-latin-600.woff2" as="font" type="font/woff2" crossorigin>
<?php endif; ?>

<link rel="stylesheet" href="<?= e(asset('assets/css/app.css')) ?>">

<?php if ($includeAppJs): ?>
<script type="module" src="<?= e(asset('assets/js/app.js')) ?>" defer></script>
<?php
/**
 * ES modules discover their imports only after each file is fetched and
 * parsed, which would serialize the graph. Preloading the heaviest static
 * modules starts every download during <head> parse instead. The URLs must
 * match the bare specifiers used by the imports (no ?v= query).
 */
foreach ([
    'editor.js',
    'codeblock.js',
    'mathblock.js',
    'table.js',
    'storage.js',
    'spellcheck.js',
] as $module):
?>
<link rel="modulepreload" href="/assets/js/<?= e($module) ?>">
<?php endforeach; ?>
<?php endif; ?>
</head>
<body<?= isset($bodyClass) ? ' class="' . e($bodyClass) . '"' : '' ?>>
<a class="skip-link" href="<?= e($skipTarget) ?>"><?= e(t('skip_link')) ?></a>
