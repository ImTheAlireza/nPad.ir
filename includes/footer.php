<?php
/**
 * Site footer and closing tags.
 * Expects: $lang
 */

declare(strict_types=1);

// Not a standalone endpoint: refuse direct requests.
if (!defined('NPAD_ROOT')) {
    http_response_code(404);
    exit;
}

$year     = date('Y');
$homePath = $lang === 'fa' ? '/fa/' : '/';
$privacy  = $lang === 'fa' ? '/fa/privacy.php' : '/privacy.php';

/** Landing pages: the internal-link mesh that keeps them crawled. */
$tools = NPAD_LANDING_SLUGS;
?>
<footer class="footer">
    <p>&copy; <?= e($year) ?> NPad. <?= e(t('footer.rights')) ?></p>
    <nav class="footer__links" aria-label="<?= e(t('footer.home')) ?>">
        <a href="<?= e($homePath) ?>"><?= e(t('footer.home')) ?></a>
        <?php foreach ($tools as $tool): ?>
            <a href="<?= e($lang === 'fa' ? "/fa/{$tool}" : "/{$tool}") ?>">
                <?= e(t("footer_tools.{$tool}")) ?>
            </a>
        <?php endforeach; ?>
        <a href="<?= e($lang === 'fa' ? '/fa/compare' : '/compare') ?>"><?= e(t('footer.compare')) ?></a>
        <a href="<?= e($privacy) ?>"><?= e(t('footer.privacy')) ?></a>
        <a href="mailto:alirezashabanzadeh01@gmail.com"><?= e(t('footer.contact')) ?></a>
    </nav>
</footer>
