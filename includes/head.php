<?php
/**
 * Document head.
 *
 * Expects: $lang, $strings, $pageTitle, $pageDesc, $canonicalPath,
 *          $bodyClass (optional), $includeAppJs (optional bool)
 */

declare(strict_types=1);

$dir            = NPAD_LANGS[$lang]['dir'];
$locale         = NPAD_LANGS[$lang]['locale'];
$canonicalPath  = $canonicalPath ?? '/';
$includeAppJs   = $includeAppJs ?? false;
$altLang        = $lang === 'en' ? 'fa' : 'en';
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
<link rel="alternate" hreflang="en" href="<?= e(npad_url('/')) ?>">
<link rel="alternate" hreflang="fa" href="<?= e(npad_url('/fa/')) ?>">
<link rel="alternate" hreflang="x-default" href="<?= e(npad_url('/')) ?>">

<meta property="og:type" content="website">
<meta property="og:site_name" content="NPad">
<meta property="og:locale" content="<?= e($locale) ?>">
<meta property="og:url" content="<?= e(npad_url($canonicalPath)) ?>">
<meta property="og:title" content="<?= e(t('meta.og_title')) ?>">
<meta property="og:description" content="<?= e(t('meta.og_desc')) ?>">
<meta name="twitter:card" content="summary">

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
// Preload the fonts actually used by this language only.
if ($lang === 'fa'): ?>
<link rel="preload" href="/fonts/vazirmatn-arabic-400.woff2" as="font" type="font/woff2" crossorigin>
<?php else: ?>
<link rel="preload" href="/fonts/inter-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<?php endif; ?>

<link rel="stylesheet" href="<?= e(asset('assets/css/app.css')) ?>">

<?php if ($includeAppJs): ?>
<script type="module" src="<?= e(asset('assets/js/app.js')) ?>" defer></script>
<?php endif; ?>
</head>
<body<?= isset($bodyClass) ? ' class="' . e($bodyClass) . '"' : '' ?>>
<a class="skip-link" href="#editor"><?= e(t('skip_link')) ?></a>
