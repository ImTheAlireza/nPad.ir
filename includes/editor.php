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

$fonts = [
    'Inter, sans-serif'          => 'Inter',
    'Vazirmatn, sans-serif'      => 'Vazirmatn',
    'Georgia, serif'             => 'Georgia',
    'Times New Roman, serif'     => 'Times New Roman',
    'Arial, sans-serif'          => 'Arial',
    'Verdana, sans-serif'        => 'Verdana',
    'Tahoma, sans-serif'         => 'Tahoma',
    'Courier New, monospace'     => 'Courier New',
];

$sizes = ['1' => '10', '2' => '13', '3' => '16', '4' => '18', '5' => '24', '6' => '32', '7' => '48'];

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

        <div class="toolbar__group" role="group" aria-label="<?= e(t('toolbar.font')) ?>">
            <select class="toolbar__select" data-command="fontName" aria-label="<?= e(t('toolbar.font')) ?>">
                <?php foreach ($fonts as $value => $label): ?>
                    <option value="<?= e($value) ?>"><?= e($label) ?></option>
                <?php endforeach; ?>
            </select>
            <select class="toolbar__select" data-command="fontSize" aria-label="<?= e(t('toolbar.size')) ?>">
                <?php foreach ($sizes as $value => $label): ?>
                    <option value="<?= e($value) ?>" <?= $value === '3' ? 'selected' : '' ?>><?= e($label) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <?php foreach ($groups as $group): ?>
            <div class="toolbar__group" role="group" aria-label="<?= e($group['label']) ?>">
                <?php foreach ($group['items'] as $item): ?>
                    <?php $isToggle = $item['toggle'] ?? ($group['toggle'] ?? false); ?>
                    <button type="button" class="toolbar__btn"
                            data-command="<?= e($item['command']) ?>"
                            title="<?= e($item['label']) ?>"
                            aria-label="<?= e($item['label']) ?>"
                            <?= $isToggle ? 'aria-pressed="false"' : '' ?>>
                        <?= icon($item['icon']) ?>
                    </button>
                <?php endforeach; ?>
            </div>
        <?php endforeach; ?>

        <div class="toolbar__group" role="group" aria-label="<?= e(t('toolbar.group_colour')) ?>">
            <label class="colorfield" title="<?= e(t('toolbar.text_colour')) ?>">
                <span class="colorfield__icon"><?= icon('palette') ?></span>
                <span class="colorfield__swatch" aria-hidden="true"></span>
                <input type="color" value="#0f172a" data-command="foreColor"
                       aria-label="<?= e(t('toolbar.text_colour')) ?>">
            </label>
            <label class="colorfield" title="<?= e(t('toolbar.highlight')) ?>">
                <span class="colorfield__icon"><?= icon('highlight') ?></span>
                <span class="colorfield__swatch" aria-hidden="true"></span>
                <input type="color" value="#fde047" data-command="hiliteColor"
                       aria-label="<?= e(t('toolbar.highlight')) ?>">
            </label>
        </div>
    </div>

    <div id="editor"
         class="editor"
         contenteditable="true"
         role="textbox"
         aria-multiline="true"
         aria-label="<?= e(t('editor.label')) ?>"
         data-placeholder="<?= e(t('editor.placeholder')) ?>"
         spellcheck="true"
         autocorrect="on"></div>

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
