<?php
/**
 * Shared controller for the notepad page in either language.
 *
 * Both /index.php and /fa/index.php delegate here, so the two locales can
 * never diverge structurally — the failure mode that left index.html a
 * thousand lines behind index.php in the previous build.
 *
 * Expects $lang to be defined by the caller.
 */

declare(strict_types=1);

// Not a standalone endpoint. This runs before bootstrap.php defines
// NPAD_ROOT, so it keys off $lang being supplied by the calling entry point.
if (!isset($lang)) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/icons.php';

$lang    = $lang ?? NPAD_DEFAULT_LANG;
$strings = npad_load_lang($lang);
t('', $strings);

$pageTitle     = t('meta.title');
$pageDesc      = t('meta.description');
$canonicalPath = NPAD_LANGS[$lang]['path'];
$includeAppJs  = true;

require __DIR__ . '/head.php';
?>
<div class="page">
    <?php
    require __DIR__ . '/appbar.php';
    require __DIR__ . '/editor.php';
    require __DIR__ . '/content.php';
    require __DIR__ . '/footer.php';
    ?>
</div>
</body>
</html>
