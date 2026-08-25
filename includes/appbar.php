<?php
/**
 * Application bar: File/Edit menus, language switch, theme toggle.
 *
 * Menus are <button>-driven with aria-expanded maintained by ui.js. The old
 * markup opened them on CSS :hover alone, which meant they could not be
 * opened at all on a touch device, and hardcoded aria-expanded="false".
 *
 * Expects: $lang
 */

declare(strict_types=1);

// Not a standalone endpoint: refuse direct requests.
if (!defined('NPAD_ROOT')) {
    http_response_code(404);
    exit;
}

$otherLang     = $lang === 'fa' ? 'en' : 'fa';
$otherLangPath = NPAD_LANGS[$otherLang]['path'];
$homePath      = NPAD_LANGS[$lang]['path'];

$fileItems = [
    ['action' => 'new',       'icon' => 'file',      'label' => t('menu.new')],
    ['action' => 'open',      'icon' => 'folder',    'label' => t('menu.open')],
    ['separator' => true],
    ['action' => 'save',      'icon' => 'download',  'label' => t('menu.save'),      'shortcut' => 'Ctrl+S'],
    ['action' => 'save-html', 'icon' => 'save',      'label' => t('menu.save_html')],
    ['action' => 'print',     'icon' => 'printer',   'label' => t('menu.print'),     'shortcut' => 'Ctrl+P'],
    ['separator' => true],
    ['action' => 'details',   'icon' => 'info',      'label' => t('menu.details')],
    ['action' => 'clear',     'icon' => 'trash',     'label' => t('menu.clear')],
];

$editItems = [
    ['action' => 'copy',        'icon' => 'copy',       'label' => t('menu.copy'),        'shortcut' => 'Ctrl+C'],
    ['action' => 'cut',         'icon' => 'scissors',   'label' => t('menu.cut'),         'shortcut' => 'Ctrl+X'],
    ['action' => 'paste',       'icon' => 'clipboard',  'label' => t('menu.paste'),       'shortcut' => 'Ctrl+V'],
    ['action' => 'paste-plain', 'icon' => 'text',       'label' => t('menu.paste_plain')],
    ['separator' => true],
    ['action' => 'find',        'icon' => 'search',     'label' => t('menu.find'),        'shortcut' => 'Ctrl+F'],
    ['action' => 'find-replace','icon' => 'find-replace','label' => t('menu.find_replace'), 'shortcut' => 'Ctrl+H'],
    ['separator' => true],
    ['action' => 'select-all',  'icon' => 'select-all', 'label' => t('menu.select_all'),  'shortcut' => 'Ctrl+A'],
];

/**
 * Render one dropdown menu.
 */
function npad_render_menu(string $id, string $label, array $items): void
{
    ?>
    <div class="menu">
        <button type="button" class="menu__trigger" id="<?= e($id) ?>Trigger"
                aria-haspopup="true" aria-expanded="false" aria-controls="<?= e($id) ?>Panel">
            <?= e($label) ?>
        </button>
        <div class="menu__panel" id="<?= e($id) ?>Panel" role="menu"
             aria-labelledby="<?= e($id) ?>Trigger" data-open="false">
            <?php foreach ($items as $item): ?>
                <?php if (!empty($item['separator'])): ?>
                    <div class="menu__separator" role="separator"></div>
                <?php else: ?>
                    <button type="button" class="menu__item" role="menuitem"
                            data-action="<?= e($item['action']) ?>">
                        <?= icon($item['icon']) ?>
                        <span><?= e($item['label']) ?></span>
                        <?php if (!empty($item['shortcut'])): ?>
                            <span class="menu__shortcut"><?= e($item['shortcut']) ?></span>
                        <?php endif; ?>
                    </button>
                <?php endif; ?>
            <?php endforeach; ?>
        </div>
    </div>
    <?php
}
?>
<header class="appbar">
    <div class="appbar__group">
        <a class="brand" href="<?= e($homePath) ?>">
            <span class="brand__mark"><?= icon('file') ?></span>
            <span class="brand__text">NPad</span>
        </a>
        <?php
        npad_render_menu('fileMenu', t('menu.file'), $fileItems);
        npad_render_menu('editMenu', t('menu.edit'), $editItems);
        ?>
    </div>

    <div class="appbar__group">
        <div class="segmented" role="group" aria-label="<?= e(t('lang_label')) ?>">
            <a class="segmented__option" href="/" hreflang="en"
               <?= $lang === 'en' ? 'aria-current="true"' : '' ?>>EN</a>
            <a class="segmented__option" href="/fa/" hreflang="fa"
               <?= $lang === 'fa' ? 'aria-current="true"' : '' ?>>فا</a>
        </div>

        <button type="button" class="iconbtn" data-action="toggle-focus"
                aria-pressed="false"
                aria-label="<?= e(t('toolbar.focus')) ?>"
                data-label-focus="<?= e(t('toolbar.focus')) ?>"
                data-label-focus-exit="<?= e(t('toolbar.focus_exit')) ?>">
            <?= icon('expand', ['class' => 'icon', 'data-icon' => 'expand']) ?>
            <?= icon('contract', ['class' => 'icon', 'data-icon' => 'contract', 'hidden' => 'hidden']) ?>
        </button>

        <button type="button" class="iconbtn" data-theme-toggle
                aria-pressed="false"
                aria-label="<?= e(t('theme.dark')) ?>"
                data-label-dark="<?= e(t('theme.dark')) ?>"
                data-label-light="<?= e(t('theme.light')) ?>">
            <?= icon('moon', ['class' => 'icon', 'data-icon' => 'moon']) ?>
            <?= icon('sun', ['class' => 'icon', 'data-icon' => 'sun', 'hidden' => 'hidden']) ?>
        </button>
    </div>
</header>
