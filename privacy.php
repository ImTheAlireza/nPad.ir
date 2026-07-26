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

require __DIR__ . '/includes/head.php';
?>
<div class="page">
    <?php require __DIR__ . '/includes/appbar.php'; ?>

    <article class="doc">
        <h1><?= e(t('privacy.title')) ?></h1>
        <p class="doc__meta"><?= e(t('privacy.updated')) ?>: <?= e(date('Y-m-d', filemtime(__FILE__))) ?></p>
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
