<?php
/**
 * Editor shell: toolbar, editing surface, status bar, dialog, toast region.
 *
 * Every control is a real <button> with an accessible name and, where it
 * toggles, aria-pressed. Groups are labelled so screen-reader users can
 * navigate the toolbar by group.
 *
 * Expects: $lang
 */

declare(strict_types=1);

// Not a standalone endpoint: refuse direct requests.
if (!defined('NPAD_ROOT')) {
    http_response_code(404);
    exit;
}

$groups = [
    [
        'label' => t('toolbar.group_history'),
        'items' => [
            ['command' => 'undo', 'icon' => 'undo', 'label' => t('toolbar.undo')],
            ['command' => 'redo', 'icon' => 'redo', 'label' => t('toolbar.redo')],
        ],
    ],
    [
        'label'  => t('toolbar.group_format'),
        'toggle' => true,
        'items'  => [
            ['command' => 'bold',          'icon' => 'bold',        'label' => t('toolbar.bold')],
            ['command' => 'italic',        'icon' => 'italic',      'label' => t('toolbar.italic')],
            ['command' => 'underline',     'icon' => 'underline',   'label' => t('toolbar.underline')],
            ['command' => 'strikeThrough', 'icon' => 'strike',      'label' => t('toolbar.strike')],
            ['command' => 'subscript',     'icon' => 'subscript',   'label' => t('toolbar.subscript')],
            ['command' => 'superscript',   'icon' => 'superscript', 'label' => t('toolbar.superscript')],
        ],
    ],
    [
        'label'  => t('toolbar.group_lists'),
        'toggle' => true,
        'items'  => [
            ['command' => 'insertUnorderedList', 'icon' => 'list-ul', 'label' => t('toolbar.bullet_list')],
            ['command' => 'insertOrderedList',   'icon' => 'list-ol', 'label' => t('toolbar.ordered_list')],
            ['command' => 'indent',              'icon' => 'indent',  'label' => t('toolbar.indent'),  'toggle' => false],
            ['command' => 'outdent',             'icon' => 'outdent', 'label' => t('toolbar.outdent'), 'toggle' => false],
        ],
    ],
    [
        'label'  => t('toolbar.group_align'),
        'toggle' => true,
        'items'  => [
            ['command' => 'justifyLeft',   'icon' => 'align-left',   'label' => t('toolbar.align_left')],
            ['command' => 'justifyCenter', 'icon' => 'align-center', 'label' => t('toolbar.align_center')],
            ['command' => 'justifyRight',  'icon' => 'align-right',  'label' => t('toolbar.align_right')],
            ['command' => 'justifyFull',   'icon' => 'align-just',   'label' => t('toolbar.align_justify')],
            ['action' => 'dir-ltr', 'icon' => 'dir-ltr', 'label' => t('toolbar.dir_ltr')],
            ['action' => 'dir-rtl', 'icon' => 'dir-rtl', 'label' => t('toolbar.dir_rtl')],
        ],
    ],
    [
        'label' => t('toolbar.group_insert'),
        'items' => [
            ['command' => 'createLink',   'icon' => 'link',   'label' => t('toolbar.link')],
            ['command' => 'removeFormat', 'icon' => 'eraser', 'label' => t('toolbar.clear_format')],
        ],
    ],
];

/**
 * Font catalogue for the custom picker. Inter and Vazirmatn are bundled;
 * the remaining faces intentionally use local system fonts, keeping notes
 * private/offline and avoiding dozens of multi-megabyte font downloads.
 */
$makeFont = static function (string $name, string $fallback, bool $builtIn = false): array {
    $generic = in_array($name, ['system-ui', 'ui-monospace', 'serif', 'sans-serif'], true);
    $cssName = $generic ? $name : "'" . str_replace("'", "\'", $name) . "'";
    return [
        'name'    => $name,
        'stack'   => $cssName . ', ' . $fallback,
        'builtIn' => $builtIn,
    ];
};

$fontGroups = [
    'persian' => [
        $makeFont('Vazirmatn', "Tahoma, Arial, sans-serif", true),
        $makeFont('Noto Sans Arabic', "Tahoma, Arial, sans-serif"),
        $makeFont('Noto Naskh Arabic', "Tahoma, Arial, serif"),
        $makeFont('Noto Kufi Arabic', "Tahoma, Arial, sans-serif"),
        $makeFont('B Nazanin', "Tahoma, Arial, serif"),
        $makeFont('B Mitra', "Tahoma, Arial, serif"),
        $makeFont('B Lotus', "Tahoma, Arial, serif"),
        $makeFont('B Yekan', "Tahoma, Arial, sans-serif"),
        $makeFont('B Koodak', "Tahoma, Arial, sans-serif"),
        $makeFont('B Titr', "Tahoma, Arial, sans-serif"),
        $makeFont('B Traffic', "Tahoma, Arial, sans-serif"),
        $makeFont('B Homa', "Tahoma, Arial, sans-serif"),
        $makeFont('B Roya', "Tahoma, Arial, sans-serif"),
        $makeFont('B Zar', "Tahoma, Arial, serif"),
        $makeFont('B Baran', "Tahoma, Arial, sans-serif"),
        $makeFont('B Morvarid', "Tahoma, Arial, serif"),
        $makeFont('B Farnaz', "Tahoma, Arial, sans-serif"),
        $makeFont('B Elham', "Tahoma, Arial, sans-serif"),
        $makeFont('B Esfehan', "Tahoma, Arial, serif"),
        $makeFont('IranNastaliq', "Tahoma, Arial, serif"),
        $makeFont('IRANSans', "Tahoma, Arial, sans-serif"),
        $makeFont('IRANSansX', "Tahoma, Arial, sans-serif"),
        $makeFont('Yekan Bakh', "Tahoma, Arial, sans-serif"),
        $makeFont('Dana', "Tahoma, Arial, sans-serif"),
        $makeFont('Shabnam', "Tahoma, Arial, sans-serif"),
        $makeFont('Sahel', "Tahoma, Arial, sans-serif"),
        $makeFont('Samim', "Tahoma, Arial, sans-serif"),
        $makeFont('Estedad', "Tahoma, Arial, sans-serif"),
        $makeFont('Anjoman', "Tahoma, Arial, sans-serif"),
        $makeFont('Peyda', "Tahoma, Arial, sans-serif"),
        $makeFont('Kalameh', "Tahoma, Arial, sans-serif"),
        $makeFont('Gandom', "Tahoma, Arial, sans-serif"),
        $makeFont('Parastoo', "Tahoma, Arial, serif"),
        $makeFont('Lalezar', "Tahoma, Arial, sans-serif"),
    ],
    'english' => [
        $makeFont('Inter', "Arial, sans-serif", true),
        $makeFont('system-ui', "sans-serif"),
        $makeFont('Arial', "sans-serif"),
        $makeFont('Helvetica', "Arial, sans-serif"),
        $makeFont('Verdana', "Arial, sans-serif"),
        $makeFont('Tahoma', "Arial, sans-serif"),
        $makeFont('Trebuchet MS', "Arial, sans-serif"),
        $makeFont('Segoe UI', "Arial, sans-serif"),
        $makeFont('Calibri', "Arial, sans-serif"),
        $makeFont('Candara', "Arial, sans-serif"),
        $makeFont('Century Gothic', "Arial, sans-serif"),
        $makeFont('Franklin Gothic Medium', "Arial, sans-serif"),
        $makeFont('Gill Sans', "Arial, sans-serif"),
        $makeFont('Optima', "Arial, sans-serif"),
        $makeFont('Futura', "Arial, sans-serif"),
        $makeFont('Avenir Next', "Arial, sans-serif"),
        $makeFont('Georgia', "serif"),
        $makeFont('Times New Roman', "serif"),
        $makeFont('Garamond', "serif"),
        $makeFont('Baskerville', "serif"),
        $makeFont('Palatino Linotype', "serif"),
        $makeFont('Book Antiqua', "serif"),
        $makeFont('Cambria', "serif"),
        $makeFont('Didot', "serif"),
        $makeFont('Hoefler Text', "serif"),
        $makeFont('Rockwell', "serif"),
        $makeFont('Courier New', "monospace"),
        $makeFont('Consolas', "monospace"),
        $makeFont('Menlo', "monospace"),
        $makeFont('Monaco', "monospace"),
        $makeFont('Lucida Console', "monospace"),
        $makeFont('ui-monospace', "monospace"),
        $makeFont('Impact', "sans-serif"),
        $makeFont('Copperplate', "serif"),
        $makeFont('Brush Script MT', "cursive"),
        $makeFont('Comic Sans MS', "cursive"),
    ],
];

$defaultFont = $lang === 'fa' ? 'Vazirmatn' : 'Inter';

/**
 * Strings handed to JavaScript. Keeping them in one JSON island means the
 * client never hardcodes English, and the two languages stay in sync.
 */
$jsStrings = [
    'words'             => t('status.words'),
    'characters'        => t('status.characters'),
    'selected'          => t('status.selected'),
    'saved'             => t('status.saved'),
    'saving'            => t('status.saving'),
    'unsaved'           => t('status.unsaved'),
    'offline'           => t('status.offline'),
    'confirm'           => t('dialog.confirm'),
    'cancel'            => t('dialog.cancel'),
    'ok'                => t('dialog.ok'),
    'newTitle'          => t('dialog.new_title'),
    'newBody'           => t('dialog.new_body'),
    'clearTitle'        => t('dialog.clear_title'),
    'clearBody'         => t('dialog.clear_body'),
    'detailsTitle'      => t('dialog.details_title'),
    'linkTitle'         => t('dialog.link_title'),
    'linkLabel'         => t('dialog.link_label'),
    'linkInvalid'       => t('dialog.link_invalid'),
    'openTooLarge'      => t('dialog.open_too_large'),
    'openFailed'        => t('dialog.open_failed'),
    'pasteBlocked'      => t('dialog.paste_blocked'),
    'copyBlocked'       => t('dialog.copy_blocked'),
    'apply'             => t('dialog.apply'),
    'colourHex'         => t('dialog.colour_hex'),
    'colourPresets'     => t('dialog.colour_presets'),
    'colourHue'         => t('dialog.colour_hue'),
    'colourArea'        => t('dialog.colour_area'),
    'colourInvalid'     => t('dialog.colour_invalid'),
    'sizeInvalid'       => t('dialog.size_invalid'),
    'textColour'        => t('toolbar.text_colour'),
    'highlightColour'   => t('toolbar.highlight'),
    'findLabel'         => t('find.label'),
    'findPlaceholder'   => t('find.placeholder'),
    'findReplacePlaceholder' => t('find.replace_placeholder'),
    'findPrev'          => t('find.prev'),
    'findNext'          => t('find.next'),
    'findReplace'       => t('find.replace'),
    'findReplaceAll'    => t('find.replace_all'),
    'findCount'         => t('find.count'),
    'findNoResults'     => t('find.no_results'),
    'findClose'         => t('find.close'),
    'spellAdd'          => t('spell.add'),
    'spellIgnore'       => t('spell.ignore'),
    'spellNoSuggestions' => t('spell.no_suggestions'),
    'detailWords'       => t('details.words'),
    'detailCharacters'  => t('details.characters'),
    'detailNoSpaces'    => t('details.no_spaces'),
    'detailParagraphs'  => t('details.paragraphs'),
    'detailReading'     => t('details.reading'),
    'minutes'           => t('details.minutes'),
    'detailSavedAt'     => t('details.saved_at'),
    'never'             => t('details.never'),
];
?>
<main class="editor-shell" id="main">
    <div class="toolbar" id="toolbar" role="toolbar" aria-label="<?= e(t('toolbar.group_format')) ?>" aria-controls="editor">

        <div class="toolbar__group toolbar__group--type" role="group" aria-label="<?= e(t('toolbar.font')) ?>">
            <button type="button" class="font-picker__trigger" id="fontPickerTrigger"
                    aria-label="<?= e(t('toolbar.font')) ?>"
                    aria-haspopup="listbox" aria-expanded="false" aria-controls="fontPickerPopup"
                    data-current-font="<?= e($defaultFont) ?>">
                <span class="font-picker__value"><?= e($defaultFont) ?></span>
                <?= icon('chevron', ['class' => 'icon font-picker__chevron']) ?>
            </button>

            <label class="sizefield" title="<?= e(t('toolbar.size')) ?>">
                <span class="visually-hidden"><?= e(t('toolbar.size')) ?></span>
                <input class="sizefield__input" type="number" value="16" min="6" max="200" step="1"
                       inputmode="numeric" data-font-size aria-label="<?= e(t('toolbar.size')) ?>">
                <span class="sizefield__unit" aria-hidden="true"><?= e(t('toolbar.size_unit')) ?></span>
            </label>
        </div>

        <?php foreach ($groups as $group): ?>
            <div class="toolbar__group" role="group" aria-label="<?= e($group['label']) ?>">
                <?php foreach ($group['items'] as $item): ?>
                    <?php $isToggle = $item['toggle'] ?? ($group['toggle'] ?? false); ?>
                    <button type="button" class="toolbar__btn"
                            <?= isset($item['command']) ? 'data-command="' . e($item['command']) . '"' : 'data-action="' . e($item['action']) . '"' ?>
                            title="<?= e($item['label']) ?>"
                            aria-label="<?= e($item['label']) ?>"
                            <?= $isToggle ? 'aria-pressed="false"' : '' ?>>
                        <?= icon($item['icon']) ?>
                    </button>
                <?php endforeach; ?>
            </div>
        <?php endforeach; ?>

        <div class="toolbar__group" role="group" aria-label="<?= e(t('toolbar.group_colour')) ?>">
            <button type="button" class="colorfield" data-color-command="foreColor" data-color="#0f172a"
                    title="<?= e(t('toolbar.text_colour')) ?>" aria-label="<?= e(t('toolbar.text_colour')) ?>">
                <span class="colorfield__icon"><?= icon('palette') ?></span>
                <span class="colorfield__swatch" style="background-color: #0f172a" aria-hidden="true"></span>
            </button>
            <button type="button" class="colorfield" data-color-command="hiliteColor" data-color="#fde047"
                    title="<?= e(t('toolbar.highlight')) ?>" aria-label="<?= e(t('toolbar.highlight')) ?>">
                <span class="colorfield__icon"><?= icon('highlight') ?></span>
                <span class="colorfield__swatch" style="background-color: #fde047" aria-hidden="true"></span>
            </button>
        </div>

        <div class="toolbar__group" role="group" aria-label="<?= e(t('toolbar.group_view')) ?>">
            <button type="button" class="toolbar__btn" data-action="find"
                    title="<?= e(t('toolbar.find')) ?>" aria-label="<?= e(t('toolbar.find')) ?>">
                <?= icon('search') ?>
            </button>
            <button type="button" class="toolbar__btn" data-action="find-replace"
                    title="<?= e(t('toolbar.find_replace')) ?>" aria-label="<?= e(t('toolbar.find_replace')) ?>">
                <?= icon('find-replace') ?>
            </button>
            <button type="button" class="toolbar__btn" data-action="toggle-spellcheck" aria-pressed="true"
                    title="<?= e(t('toolbar.spellcheck')) ?>" aria-label="<?= e(t('toolbar.spellcheck')) ?>">
                <?= icon('spellcheck') ?>
            </button>
        </div>
    </div>

    <div class="findbar" id="findBar" role="search" aria-label="<?= e(t('find.label')) ?>" hidden>
        <div class="findbar__row">
            <label class="visually-hidden" for="findInput"><?= e(t('find.placeholder')) ?></label>
            <input type="search" class="findbar__input" id="findInput" data-find-input
                   placeholder="<?= e(t('find.placeholder')) ?>" autocomplete="off" spellcheck="false">
            <span class="findbar__count" id="findCount" aria-live="polite"></span>
            <button type="button" class="findbar__btn" data-find-action="prev"
                    title="<?= e(t('find.prev')) ?>" aria-label="<?= e(t('find.prev')) ?>">
                <?= icon('chevron-up', ['class' => 'icon']) ?>
            </button>
            <button type="button" class="findbar__btn" data-find-action="next"
                    title="<?= e(t('find.next')) ?>" aria-label="<?= e(t('find.next')) ?>">
                <?= icon('chevron-down', ['class' => 'icon']) ?>
            </button>
            <button type="button" class="findbar__btn" data-find-action="close"
                    title="<?= e(t('find.close')) ?>" aria-label="<?= e(t('find.close')) ?>">
                <?= icon('close', ['class' => 'icon']) ?>
            </button>
        </div>
        <div class="findbar__row" id="findReplaceRow" hidden>
            <label class="visually-hidden" for="replaceInput"><?= e(t('find.replace_placeholder')) ?></label>
            <input type="text" class="findbar__input" id="replaceInput" data-find-replace
                   placeholder="<?= e(t('find.replace_placeholder')) ?>" autocomplete="off" spellcheck="false">
            <button type="button" class="findbar__btn findbar__btn--primary" data-find-action="replace">
                <?= e(t('find.replace')) ?>
            </button>
            <button type="button" class="findbar__btn" data-find-action="replace-all">
                <?= e(t('find.replace_all')) ?>
            </button>
        </div>
    </div>

    <div id="editor"
         class="editor"
         contenteditable="true"
         role="textbox"
         aria-multiline="true"
         aria-label="<?= e(t('editor.label')) ?>"
         data-placeholder="<?= e(t('editor.placeholder')) ?>"
         spellcheck="false"
         autocorrect="off"></div>

    <div class="statusbar" id="statusbar" data-save-state="saved">
        <div class="statusbar__counts" id="statusCounts" role="status" aria-live="polite">
            <?= e(t('status.words')) ?>: 0 · <?= e(t('status.characters')) ?>: 0
        </div>
        <div class="statusbar__state">
            <span class="statusbar__dot" aria-hidden="true"></span>
            <span id="saveState"><?= e(t('status.saved')) ?></span>
        </div>
    </div>
</main>

<button type="button" class="focus-exit" data-action="toggle-focus" hidden
        title="<?= e(t('toolbar.focus_exit')) ?>" aria-label="<?= e(t('toolbar.focus_exit')) ?>">
    <?= icon('contract', ['class' => 'icon']) ?>
</button>

<div class="font-picker__popup" id="fontPickerPopup" data-open="false" hidden>
    <div class="font-picker__search-wrap">
        <?= icon('search', ['class' => 'icon font-picker__search-icon']) ?>
        <input type="search" class="font-picker__search" id="fontPickerSearch"
               placeholder="<?= e(t('toolbar.font_search')) ?>"
               aria-label="<?= e(t('toolbar.font_search')) ?>" autocomplete="off" spellcheck="false">
    </div>
    <div class="font-picker__list" id="fontPickerList" role="listbox"
         aria-label="<?= e(t('toolbar.font')) ?>" tabindex="-1">
        <?php foreach ($fontGroups as $groupName => $fonts): ?>
            <section class="font-picker__group" data-font-group>
                <h3 class="font-picker__heading">
                    <?= e(t('toolbar.fonts_' . $groupName)) ?>
                </h3>
                <?php foreach ($fonts as $index => $font): ?>
                    <?php $selected = $font['name'] === $defaultFont; ?>
                    <button type="button" class="font-picker__option" role="option" tabindex="-1"
                            id="fontOption-<?= e($groupName) ?>-<?= $index ?>"
                            data-font-option data-font="<?= e($font['name']) ?>"
                            data-font-stack="<?= e($font['stack']) ?>"
                            aria-selected="<?= $selected ? 'true' : 'false' ?>"
                            style="font-family: <?= e($font['stack']) ?>">
                        <span class="font-picker__name" dir="auto"><?= e($font['name']) ?></span>
                        <span class="font-picker__sample" aria-hidden="true">
                            <?= $groupName === 'persian' ? 'ابجد' : 'Aa' ?>
                        </span>
                        <?php if ($font['builtIn']): ?>
                            <span class="font-picker__badge"><?= e(t('toolbar.fonts_built_in')) ?></span>
                        <?php endif; ?>
                    </button>
                <?php endforeach; ?>
            </section>
        <?php endforeach; ?>
        <p class="font-picker__empty" data-font-empty hidden><?= e(t('toolbar.no_fonts')) ?></p>
    </div>
    <p class="font-picker__note"><?= e(t('toolbar.fonts_device')) ?></p>
</div>

<dialog class="dialog" id="appDialog" aria-labelledby="dialogTitle">
    <div class="dialog__header">
        <h2 class="dialog__title" id="dialogTitle"></h2>
        <button type="button" class="dialog__close" aria-label="<?= e(t('dialog.close')) ?>">
            <?= icon('close') ?>
        </button>
    </div>
    <div class="dialog__body"></div>
    <div class="dialog__footer"></div>
</dialog>

<div class="toast-region" id="toastRegion" role="status" aria-live="polite" aria-atomic="false"></div>

<script type="application/json" id="i18n"><?= json_encode($jsStrings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
