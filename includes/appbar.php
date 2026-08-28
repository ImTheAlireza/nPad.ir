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

// "Chrome only" mode for non-editor pages (landing, compare, privacy): render
// the brand, language switch and theme toggle, but not the File/Edit/Insert
// menus or the focus toggle — those act on an editor that isn't on the page,
// and their JavaScript is never loaded there, so they would be dead controls.
$appbarChrome  = $appbarChrome ?? false;

$fileItems = [
    ['action' => 'new',       'icon' => 'file',      'label' => t('menu.new')],
    ['action' => 'open',      'icon' => 'folder',    'label' => t('menu.open')],
    ['separator' => true],
    [
        'icon'      => 'download',
        'label'     => t('menu.export'),
        'submenuId' => 'Export',
        'children'  => [
            ['action' => 'save',          'icon' => 'file',  'label' => t('menu.save'),          'shortcut' => 'Ctrl+S'],
            ['action' => 'save-html',     'icon' => 'save',  'label' => t('menu.save_html')],
            ['action' => 'save-markdown', 'icon' => 'save',  'label' => t('menu.save_markdown')],
            ['action' => 'save-json',     'icon' => 'save',  'label' => t('menu.save_json')],
            ['action' => 'save-docx',     'icon' => 'save',  'label' => t('menu.save_docx')],
            ['action' => 'save-pdf',      'icon' => 'save',  'label' => t('menu.save_pdf')],
            ['action' => 'save-rtf',      'icon' => 'save',  'label' => t('menu.save_rtf')],
        ],
    ],
    ['separator' => true],
    ['action' => 'print',         'icon' => 'printer',  'label' => t('menu.print'), 'shortcut' => 'Ctrl+P'],
    ['separator' => true],
    ['action' => 'details',   'icon' => 'info',      'label' => t('menu.details')],
    ['action' => 'backups',   'icon' => 'undo',      'label' => t('menu.backups')],
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
    ['action' => 'tasks-overview', 'icon' => 'check-square', 'label' => t('menu.tasks')],
    ['separator' => true],
    ['action' => 'select-all',  'icon' => 'select-all', 'label' => t('menu.select_all'),  'shortcut' => 'Ctrl+A'],
];

$insertItems = [
    ['action' => 'insert-table', 'icon' => 'table', 'label' => t('menu.table')],
    ['action' => 'insert-code',  'icon' => 'code',  'label' => t('menu.code_block')],
    ['action' => 'insert-math',  'icon' => 'sigma', 'label' => t('menu.math')],
    ['action' => 'insert-section', 'icon' => 'section', 'label' => t('menu.section')],
    ['action' => 'insert-checklist', 'icon' => 'check-square', 'label' => t('menu.checklist')],
    ['separator' => true],
    ['action' => 'insert-hr',     'icon' => 'hr',    'label' => t('menu.horizontal_rule')],
    ['action' => 'insert-datetime', 'icon' => 'calendar', 'label' => t('menu.date_time')],
    ['action' => 'insert-link',   'icon' => 'link',  'label' => t('menu.link')],
];

/**
 * Render one dropdown menu, including any nested submenu an item carries
 * under 'children' (rendered as a flyout panel; ui.js wires the behaviour).
 */
function npad_render_menu(string $id, string $label, array $items): void
{
    $renderItem = static function (array $item, string $parentId, int $index) use (&$renderItem): void {
        if (!empty($item['separator'])) {
            echo '<div class="menu__separator" role="separator"></div>';
            return;
        }
        if (!empty($item['children'])) {
            $subId = $parentId . ($item['submenuId'] ?? 'Sub' . $index);
            ?>
            <div class="menu__submenu">
                <button type="button" class="menu__item" id="<?= e($subId) ?>Trigger"
                        role="menuitem" aria-haspopup="menu" aria-expanded="false"
                        aria-controls="<?= e($subId) ?>Panel" data-submenu-trigger>
                    <?= icon($item['icon']) ?>
                    <span><?= e($item['label']) ?></span>
                    <span class="menu__submenu-arrow" aria-hidden="true"></span>
                </button>
                <div class="menu__panel menu__panel--submenu" id="<?= e($subId) ?>Panel"
                     role="menu" aria-labelledby="<?= e($subId) ?>Trigger" data-open="false">
                    <?php foreach ($item['children'] as $childIndex => $child): ?>
                        <?php $renderItem($child, $subId, $childIndex); ?>
                    <?php endforeach; ?>
                </div>
            </div>
            <?php
            return;
        }
        ?>
        <button type="button" class="menu__item" role="menuitem"
                data-action="<?= e($item['action']) ?>">
            <?= icon($item['icon']) ?>
            <span><?= e($item['label']) ?></span>
            <?php if (!empty($item['shortcut'])): ?>
                <span class="menu__shortcut"><?= e($item['shortcut']) ?></span>
            <?php endif; ?>
        </button>
        <?php
    };
    $hasSubmenu = (bool) array_filter($items, static fn(array $item): bool => !empty($item['children']));
    ?>
    <div class="menu">
        <button type="button" class="menu__trigger" id="<?= e($id) ?>Trigger"
                aria-haspopup="true" aria-expanded="false" aria-controls="<?= e($id) ?>Panel">
            <?= e($label) ?>
        </button>
        <div class="menu__panel<?= $hasSubmenu ? ' menu__panel--has-submenu' : '' ?>" id="<?= e($id) ?>Panel" role="menu"
             aria-labelledby="<?= e($id) ?>Trigger" data-open="false">
            <?php foreach ($items as $index => $item): ?>
                <?php $renderItem($item, $id, $index); ?>
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
        <?php if (!$appbarChrome):
        npad_render_menu('fileMenu', t('menu.file'), $fileItems);
        npad_render_menu('editMenu', t('menu.edit'), $editItems);
        npad_render_menu('insertMenu', t('menu.insert'), $insertItems);
        endif; ?>
    </div>

    <div class="appbar__group">
        <div class="segmented" role="group" aria-label="<?= e(t('lang_label')) ?>">
            <a class="segmented__option" href="/" hreflang="en"
               <?= $lang === 'en' ? 'aria-current="true"' : '' ?>>EN</a>
            <a class="segmented__option" href="/fa/" hreflang="fa"
               <?= $lang === 'fa' ? 'aria-current="true"' : '' ?>>فا</a>
        </div>

        <?php if (!$appbarChrome): ?>
        <button type="button" class="iconbtn" data-action="toggle-focus"
                aria-pressed="false"
                aria-label="<?= e(t('toolbar.focus')) ?>"
                data-label-focus="<?= e(t('toolbar.focus')) ?>"
                data-label-focus-exit="<?= e(t('toolbar.focus_exit')) ?>">
            <?= icon('expand', ['class' => 'icon', 'data-icon' => 'expand']) ?>
            <?= icon('contract', ['class' => 'icon', 'data-icon' => 'contract', 'hidden' => 'hidden']) ?>
        </button>
        <?php endif; ?>

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
