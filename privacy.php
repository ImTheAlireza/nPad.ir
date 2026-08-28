<?php
/**
 * Privacy policy (English).
 *
 * Replaces the previous alert() that claimed "We do not collect or store any
 * personal information" while track.php was logging IP and user agent on
 * every page view. This page describes what is actually recorded.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/icons.php';

$lang    = $lang ?? 'en';
$strings = npad_load_lang($lang);
t('', $strings);

$pageTitle     = t('privacy.title') . ' — NPad';
$pageDesc      = t('privacy.intro');
$canonicalPath = $lang === 'fa' ? '/fa/privacy.php' : '/privacy.php';
$skipTarget    = '#main';

// Content page: chrome-only app bar + theme-toggle JS only.
$appbarChrome   = true;
$includeThemeJs = true;

require __DIR__ . '/includes/head.php';
?>
<div class="page">
    <?php require __DIR__ . '/includes/appbar.php'; ?>

    <article class="doc" id="main">
        <h1><?= e(t('privacy.title')) ?></h1>
        <p class="doc__meta"><?= e(t('privacy.updated')) ?>: <?= e(npad_content_lastmod('privacy.php', 'lang/' . $lang . '.php')) ?></p>
        <p><?= e(t('privacy.intro')) ?></p>

        <?php foreach (t('privacy.sections') as $section): ?>
            <h2><?= e($section['heading']) ?></h2>
            <p><?= e($section['body']) ?></p>
        <?php endforeach; ?>
    </article>

    <?php require __DIR__ . '/includes/footer.php'; ?>
</div>
</body>
</html>
