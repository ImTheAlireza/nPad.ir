<?php
/**
 * Site footer and closing tags.
 * Expects: $lang
 */

declare(strict_types=1);

$year     = date('Y');
$homePath = $lang === 'fa' ? '/fa/' : '/';
$privacy  = $lang === 'fa' ? '/fa/privacy.php' : '/privacy.php';
?>
<footer class="footer">
    <p>&copy; <?= e($year) ?> NPad. <?= e(t('footer.rights')) ?></p>
    <nav class="footer__links" aria-label="<?= e(t('footer.home')) ?>">
        <a href="<?= e($homePath) ?>"><?= e(t('footer.home')) ?></a>
        <a href="<?= e($privacy) ?>"><?= e(t('footer.privacy')) ?></a>
        <a href="mailto:alirezashabanzadeh01@gmail.com"><?= e(t('footer.contact')) ?></a>
    </nav>
</footer>
