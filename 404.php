<?php
/**
 * 404 handler. Wired up via ErrorDocument in .htaccess.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/icons.php';

http_response_code(404);

// Keep Persian visitors in Persian when they 404 under /fa/.
$requestPath = $_SERVER['REQUEST_URI'] ?? '/';
$lang        = str_starts_with($requestPath, '/fa/') ? 'fa' : 'en';

$strings = npad_load_lang($lang);
t('', $strings);

$pageTitle     = t('error.404_title') . ' — NPad';
$pageDesc      = t('error.404_body');
$canonicalPath = NPAD_LANGS[$lang]['path'];

require __DIR__ . '/includes/head.php';
?>
<div class="page">
    <div class="center-panel">
        <div>
            <h1><?= e(t('error.404_title')) ?></h1>
            <p style="margin:var(--space-3) 0 var(--space-5)"><?= e(t('error.404_body')) ?></p>
            <a class="btn btn--primary" href="<?= e(NPAD_LANGS[$lang]['path']) ?>">
                <?= e(t('error.back')) ?>
            </a>
        </div>
    </div>
</div>
</body>
</html>
