<?php
/**
 * Sitemap.
 *
 * Generated from the filesystem so lastmod is always accurate and only real
 * URLs are listed. The previous static sitemap.xml advertised /blog/ plus
 * five blog posts and /fa/ — none of which existed — and pinned every
 * lastmod to 2025-01-01.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

header('Content-Type: application/xml; charset=utf-8');

/** path => file backing it, for lastmod */
$pages = [
    '/'             => NPAD_ROOT . '/index.php',
    '/fa/'          => NPAD_ROOT . '/fa/index.php',
    '/privacy.php'  => NPAD_ROOT . '/privacy.php',
    '/fa/privacy.php' => NPAD_ROOT . '/privacy.php',
];

$priorities = ['/' => '1.0', '/fa/' => '0.9', '/privacy.php' => '0.3', '/fa/privacy.php' => '0.3'];

/** Content changes when the template or its copy changes. */
$contentMtime = max(
    (int) @filemtime(NPAD_ROOT . '/includes/content.php'),
    (int) @filemtime(NPAD_ROOT . '/lang/en.php'),
    (int) @filemtime(NPAD_ROOT . '/lang/fa.php'),
);

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
<?php foreach ($pages as $path => $file): ?>
<?php
    $mtime = max((int) @filemtime($file), $contentMtime);
    $isFa  = str_starts_with($path, '/fa/');
    $enAlt = $isFa ? str_replace('/fa/', '/', $path) : $path;
    $faAlt = $isFa ? $path : ($path === '/' ? '/fa/' : '/fa' . $path);
?>
  <url>
    <loc><?= e(npad_url($path)) ?></loc>
    <lastmod><?= e(date('Y-m-d', $mtime ?: time())) ?></lastmod>
    <changefreq>monthly</changefreq>
    <priority><?= e($priorities[$path] ?? '0.5') ?></priority>
    <xhtml:link rel="alternate" hreflang="en" href="<?= e(npad_url($enAlt)) ?>"/>
    <xhtml:link rel="alternate" hreflang="fa" href="<?= e(npad_url($faAlt)) ?>"/>
  </url>
<?php endforeach; ?>
</urlset>
