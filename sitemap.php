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

/** path => files whose content determines that page's lastmod */
$landingSlugs = NPAD_LANDING_SLUGS;
$landingFiles = ['includes/landing.php', 'lang/en.php', 'lang/fa.php'];

$pages = [
    '/'               => ['includes/page.php', 'includes/editor.php', 'includes/appbar.php',
                          'includes/content.php', 'lang/en.php', 'lang/fa.php'],
    '/fa/'            => ['includes/page.php', 'includes/editor.php', 'includes/appbar.php',
                          'includes/content.php', 'lang/en.php', 'lang/fa.php'],
    '/privacy.php'    => ['privacy.php', 'includes/appbar.php', 'lang/en.php', 'lang/fa.php'],
    '/fa/privacy.php' => ['privacy.php', 'includes/appbar.php', 'lang/en.php', 'lang/fa.php'],
];
foreach ($landingSlugs as $landingSlug) {
    $pages["/{$landingSlug}"]     = $landingFiles;
    $pages["/fa/{$landingSlug}"]  = $landingFiles;
}

// Comparison page: its own template, not a landing.pages.* slug.
$compareFiles = ['includes/compare.php', 'lang/en.php', 'lang/fa.php'];
$pages['/compare']    = $compareFiles;
$pages['/fa/compare'] = $compareFiles;

$priorities = [
    '/' => '1.0', '/fa/' => '0.9',
    '/privacy.php' => '0.3', '/fa/privacy.php' => '0.3',
    '/online-notepad' => '0.8', '/fa/online-notepad' => '0.8',
    '/markdown-editor' => '0.7', '/fa/markdown-editor' => '0.7',
    '/math-notepad' => '0.7', '/fa/math-notepad' => '0.7',
    '/checklist-app' => '0.7', '/fa/checklist-app' => '0.7',
    '/text-editor' => '0.7', '/fa/text-editor' => '0.7',
    '/word-counter' => '0.7', '/fa/word-counter' => '0.7',
    '/rich-text-editor' => '0.7', '/fa/rich-text-editor' => '0.7',
    '/compare' => '0.6', '/fa/compare' => '0.6',
];

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
<?php foreach ($pages as $path => $files): ?>
<?php
    // Content-hash based: an unrelated deploy (which resets every filemtime)
    // no longer bumps lastmod. See npad_content_lastmod().
    $mtime = npad_content_lastmod(...$files);
    $isFa  = str_starts_with($path, '/fa/');
    $enAlt = $isFa ? str_replace('/fa/', '/', $path) : $path;
    $faAlt = $isFa ? $path : ($path === '/' ? '/fa/' : '/fa' . $path);
?>
  <url>
    <loc><?= e(npad_url($path)) ?></loc>
    <lastmod><?= e($mtime) ?></lastmod>
    <changefreq>monthly</changefreq>
    <priority><?= e($priorities[$path] ?? '0.5') ?></priority>
    <xhtml:link rel="alternate" hreflang="en" href="<?= e(npad_url($enAlt)) ?>"/>
    <xhtml:link rel="alternate" hreflang="fa" href="<?= e(npad_url($faAlt)) ?>"/>
  </url>
<?php endforeach; ?>
</urlset>
