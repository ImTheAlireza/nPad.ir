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
    'close'             => t('dialog.close'),
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
    'openUnsupportedType' => t('dialog.open_unsupported_type'),
    'openUnsupported'   => t('dialog.open_unsupported'),
    'openPdfEncrypted'  => t('dialog.open_pdf_encrypted'),
    'openPdfNoText'     => t('dialog.open_pdf_no_text'),
    'openPdfUnsupported' => t('dialog.open_pdf_unsupported'),
    'pdfExportTitle'    => t('dialog.pdf_export_title'),
    'pdfExportBody'     => t('dialog.pdf_export_body'),
    'pdfExportContinue' => t('dialog.pdf_export_continue'),
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
    'findCaseSensitive' => t('find.case_sensitive'),
    'findWholeWord'     => t('find.whole_word'),
    'findRegex'         => t('find.regular_expression'),
    'findInSelection'   => t('find.in_selection'),
    'findInvalidRegex'  => t('find.invalid_regex'),
    'findCount'         => t('find.count'),
    'findNoResults'     => t('find.no_results'),
    'findClose'         => t('find.close'),
    'spellAdd'          => t('spell.add'),
    'spellIgnore'       => t('spell.ignore'),
    'spellNoSuggestions' => t('spell.no_suggestions'),
    'spellSuggestionsFor' => t('spell.suggestions_for'),
    'tableToolbarLabel' => t('table.toolbar_label'),
    'tableCellColour'   => t('table.cell_colour'),
    'tableDialogTitle'  => t('table.dialog_title'),
    'tablePresetPlain'  => t('table.preset_plain'),
    'tablePresetHeader' => t('table.preset_header'),
    'tablePresetClassic' => t('table.preset_classic'),
    'tableRows'         => t('table.rows'),
    'tableColumns'      => t('table.columns'),
    'tableHeaderRow'    => t('table.header_row'),
    'tableHeaderColumn' => t('table.header_column'),
    'tableWidth'        => t('table.width'),
    'tableWidthAuto'    => t('table.width_auto'),
    'tableWidthFull'    => t('table.width_full'),
    'tableSizeHint'     => t('table.size_hint'),
    'tableInsert'       => t('table.insert'),
    'tableInserted'     => t('table.inserted'),
    'tableMergeHint'    => t('table.merge_hint'),
    'tableSplitHint'    => t('table.split_hint'),
    'tableSortUnsupported' => t('table.sort_unsupported'),
    'tableDeleteTitle'  => t('table.delete_title'),
    'tableDeleteBody'   => t('table.delete_body'),
    'tablePropertiesTitle' => t('table.properties_title'),
    'tableCaption'      => t('table.caption'),
    'tableBorders'      => t('table.borders'),
    'imageToolbarLabel' => t('image.toolbar_label'),
    'imageInsert'       => t('image.insert'),
    'imageReplace'      => t('image.replace'),
    'imageRemove'       => t('image.remove'),
    'imageEdit'         => t('image.edit'),
    'imageCrop'         => t('image.crop'),
    'imageSize'         => t('image.size'),
    'imageSizeSmall'    => t('image.size_small'),
    'imageSizeMedium'   => t('image.size_medium'),
    'imageSizeLarge'    => t('image.size_large'),
    'imageSizeFull'     => t('image.size_full'),
    'imageSizeCustom'   => t('image.size_custom'),
    'imageLayoutStart'  => t('image.layout_start'),
    'imageLayoutCenter' => t('image.layout_center'),
    'imageLayoutEnd'    => t('image.layout_end'),
    'imageDescribeTitle' => t('image.describe_title'),
    'imageDetailsTitle' => t('image.details_title'),
    'imageAlt'          => t('image.alt'),
    'imageAltHint'      => t('image.alt_hint'),
    'imageDecorative'   => t('image.decorative'),
    'imageCaption'      => t('image.caption'),
    'imageLayout'       => t('image.layout'),
    'imageLayoutBlock'  => t('image.layout_block'),
    'imageWidth'        => t('image.width'),
    'imageWidthUnit'    => t('image.width_unit'),
    'imageSaveDetails'  => t('image.save_details'),
    'imageDescriptionNeeded' => t('image.description_needed'),
    'imageDecorativeLabel' => t('image.decorative_label'),
    'imageMissing'      => t('image.missing'),
    'imageCropTitle'    => t('image.crop_title'),
    'imageCropHint'     => t('image.crop_hint'),
    'imageCropOriginal' => t('image.crop_original'),
    'imageCropSquare'   => t('image.crop_square'),
    'imageCropFourThree' => t('image.crop_four_three'),
    'imageCropSixteenNine' => t('image.crop_sixteen_nine'),
    'imageCropX'        => t('image.crop_x'),
    'imageCropY'        => t('image.crop_y'),
    'imageCropWidth'    => t('image.crop_width'),
    'imageCropHeight'   => t('image.crop_height'),
    'imageCropReset'    => t('image.crop_reset'),
    'imageCropApply'    => t('image.crop_apply'),
    'imageTooLarge'     => t('image.too_large'),
    'imageTooManyPixels' => t('image.too_many_pixels'),
    'imageUnsupported'  => t('image.unsupported'),
    'imageTypeMismatch' => t('image.type_mismatch'),
    'imageInvalid'      => t('image.invalid'),
    'imageStorageFailed' => t('image.storage_failed'),
    'imageInserted'     => t('image.inserted'),
    'imageHandleNw'     => t('image.handle_nw'),
    'imageHandleNe'     => t('image.handle_ne'),
    'imageHandleSw'     => t('image.handle_sw'),
    'imageHandleSe'     => t('image.handle_se'),
    'noteUntitled'      => t('notes.untitled'),
    'noteEmptyPreview'  => t('notes.empty_preview'),
    'noteTabsLabel'     => t('notes.tabs_label'),
    'noteCloseTab'      => t('notes.close_tab'),
    'noteUnsavedTab'    => t('notes.unsaved_tab'),
    'noteShow'          => t('notes.show'),
    'noteHide'          => t('notes.hide'),
    'notePin'           => t('notes.pin'),
    'noteUnpin'         => t('notes.unpin'),
    'noteRename'        => t('notes.rename'),
    'noteRenameTitle'   => t('notes.rename_title'),
    'noteRenameLabel'   => t('notes.rename_label'),
    'noteCopySuffix'    => t('notes.copy_suffix'),
    'noteDelete'        => t('notes.delete'),
    'noteDeleteTitle'   => t('notes.delete_title'),
    'noteDeleteBody'    => t('notes.delete_body'),
    'noFolder'          => t('notes.no_folder'),
    'folderLabel'       => t('notes.folder_label'),
    'folderMenu'        => t('notes.folder_menu'),
    'addFolderTitle'    => t('notes.add_folder_title'),
    'renameFolderTitle' => t('notes.rename_folder_title'),
    'folderName'        => t('notes.folder_name'),
    'createFolder'      => t('notes.create_folder'),
    'deleteFolderTitle' => t('notes.delete_folder_title'),
    'deleteFolderBody'  => t('notes.delete_folder_body'),
    'addTagTitle'       => t('notes.add_tag_title'),
    'editTagTitle'      => t('notes.edit_tag_title'),
    'saveTag'           => t('notes.save_tag'),
    'tagName'           => t('notes.tag_name'),
    'tagColor'          => t('notes.tag_color'),
    'createTag'         => t('notes.create_tag'),
    'deleteTagTitle'    => t('notes.delete_tag_title'),
    'deleteTagBody'     => t('notes.delete_tag_body'),
    'manageTags'        => t('notes.manage_tags'),
    'noTags'            => t('notes.no_tags'),
    'removeTag'         => t('notes.remove_tag'),
    'organizationDuplicate' => t('notes.duplicate_name'),
    'backupTitle'       => t('backups.title'),
    'backupIntro'       => t('backups.intro'),
    'backupPrivacy'     => t('backups.privacy'),
    'backupEmpty'       => t('backups.empty'),
    'backupCount'       => t('backups.count'),
    'backupAutomatic'   => t('backups.automatic'),
    'backupDeleted'     => t('backups.deleted'),
    'backupCleared'     => t('backups.cleared'),
    'backupMissing'     => t('backups.missing'),
    'backupRestore'     => t('backups.restore'),
    'backupDelete'      => t('backups.delete'),
    'backupDeleteTitle' => t('backups.delete_title'),
    'backupDeleteBody'  => t('backups.delete_body'),
    'backupClear'       => t('backups.clear'),
    'backupClearTitle'  => t('backups.clear_title'),
    'backupClearBody'   => t('backups.clear_body'),
    'backupRestored'    => t('backups.restored'),
    'backupRestoredSuffix' => t('backups.restored_suffix'),
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
<div class="notes-workspace" id="notesWorkspace" data-notes-open="false">
    <aside class="notes-sidebar" id="notesSidebar" aria-label="<?= e(t('notes.title')) ?>" inert>
        <div class="notes-sidebar__header">
            <h2 class="notes-sidebar__title"><?= e(t('notes.title')) ?></h2>
            <div class="notes-sidebar__header-actions">
                <button type="button" class="notes-sidebar__iconbtn" data-action="new"
                        title="<?= e(t('notes.new')) ?>" aria-label="<?= e(t('notes.new')) ?>">
                    <?= icon('plus') ?>
                </button>
                <button type="button" class="notes-sidebar__iconbtn notes-sidebar__close" data-action="toggle-notes"
                        aria-expanded="false" aria-controls="notesSidebar"
                        title="<?= e(t('notes.hide')) ?>" aria-label="<?= e(t('notes.hide')) ?>">
                    <?= icon('close') ?>
                </button>
            </div>
        </div>

        <nav class="notes-organizer" aria-label="<?= e(t('notes.organize')) ?>">
            <div class="organization-quickfilters">
                <button type="button" class="organization-filter" data-filter-type="all" aria-pressed="true">
                    <?= icon('file') ?>
                    <span class="organization-filter__name"><?= e(t('notes.all')) ?></span>
                    <span class="organization-filter__count" data-filter-count="all">0</span>
                </button>
                <button type="button" class="organization-filter" data-filter-type="pinned" aria-pressed="false">
                    <?= icon('pin') ?>
                    <span class="organization-filter__name"><?= e(t('notes.pinned')) ?></span>
                    <span class="organization-filter__count" data-filter-count="pinned">0</span>
                </button>
                <button type="button" class="organization-filter" data-filter-type="unfiled" aria-pressed="false">
                    <?= icon('folder') ?>
                    <span class="organization-filter__name"><?= e(t('notes.unfiled')) ?></span>
                    <span class="organization-filter__count" data-filter-count="unfiled">0</span>
                </button>
            </div>

            <section class="organization-section">
                <div class="organization-section__header">
                    <h3><?= e(t('notes.folders')) ?></h3>
                    <button type="button" class="organization-section__add" data-organization-action="add-folder"
                            title="<?= e(t('notes.add_folder')) ?>" aria-label="<?= e(t('notes.add_folder')) ?>">
                        <?= icon('plus') ?>
                    </button>
                </div>
                <div id="foldersList"></div>
            </section>

            <section class="organization-section">
                <div class="organization-section__header">
                    <h3><?= e(t('notes.tags')) ?></h3>
                    <button type="button" class="organization-section__add" data-organization-action="add-tag"
                            title="<?= e(t('notes.add_tag')) ?>" aria-label="<?= e(t('notes.add_tag')) ?>">
                        <?= icon('plus') ?>
                    </button>
                </div>
                <div id="tagsList"></div>
            </section>
        </nav>

        <template id="folderItemTemplate">
            <div class="organization-row">
                <button type="button" class="organization-filter" data-filter-type="folder" aria-pressed="false">
                    <?= icon('folder') ?>
                    <span class="organization-filter__name"></span>
                    <span class="organization-filter__count"></span>
                </button>
                <div class="organization-row__actions">
                    <button type="button" class="organization-row__action" data-organization-action="rename-folder"
                            title="<?= e(t('notes.rename')) ?>" aria-label="<?= e(t('notes.rename')) ?>">
                        <?= icon('pen') ?>
                    </button>
                    <button type="button" class="organization-row__action organization-row__action--danger"
                            data-organization-action="delete-folder"
                            title="<?= e(t('notes.delete')) ?>" aria-label="<?= e(t('notes.delete')) ?>">
                        <?= icon('trash') ?>
                    </button>
                </div>
            </div>
        </template>

        <template id="tagFilterTemplate">
            <div class="organization-row">
                <button type="button" class="organization-filter organization-filter--tag"
                        data-filter-type="tag" aria-pressed="false">
                    <span class="organization-filter__dot" aria-hidden="true"></span>
                    <span class="organization-filter__name"></span>
                    <span class="organization-filter__count"></span>
                </button>
                <div class="organization-row__actions">
                    <button type="button" class="organization-row__action" data-organization-action="edit-tag"
                            title="<?= e(t('notes.rename')) ?>" aria-label="<?= e(t('notes.rename')) ?>">
                        <?= icon('pen') ?>
                    </button>
                    <button type="button" class="organization-row__action organization-row__action--danger"
                            data-organization-action="delete-tag"
                            title="<?= e(t('notes.delete')) ?>" aria-label="<?= e(t('notes.delete')) ?>">
                        <?= icon('trash') ?>
                    </button>
                </div>
            </div>
        </template>

        <label class="notes-search">
            <?= icon('search', ['class' => 'icon notes-search__icon']) ?>
            <span class="visually-hidden"><?= e(t('notes.search_label')) ?></span>
            <input type="search" class="notes-search__input" id="notesSearch"
                   placeholder="<?= e(t('notes.search')) ?>" autocomplete="off" spellcheck="false">
        </label>

        <div class="notes-list" id="notesList"></div>
        <p class="notes-empty" id="notesEmpty" hidden><?= e(t('notes.empty')) ?></p>

        <template id="noteItemTemplate">
            <article class="note-item">
                <button type="button" class="note-item__open" data-note-action="open">
                    <span class="note-item__topline">
                        <span class="note-item__title" dir="auto"></span>
                        <span class="note-item__time"></span>
                    </span>
                    <span class="note-item__preview" dir="auto"></span>
                    <span class="note-item__metadata"></span>
                </button>
                <div class="note-item__actions">
                    <button type="button" class="note-item__action" data-note-action="pin"
                            title="<?= e(t('notes.pin')) ?>" aria-label="<?= e(t('notes.pin')) ?>" aria-pressed="false">
                        <?= icon('pin') ?>
                    </button>
                    <button type="button" class="note-item__action" data-note-action="rename"
                            title="<?= e(t('notes.rename')) ?>" aria-label="<?= e(t('notes.rename')) ?>">
                        <?= icon('pen') ?>
                    </button>
                    <button type="button" class="note-item__action" data-note-action="duplicate"
                            title="<?= e(t('notes.duplicate')) ?>" aria-label="<?= e(t('notes.duplicate')) ?>">
                        <?= icon('copy') ?>
                    </button>
                    <button type="button" class="note-item__action note-item__action--danger" data-note-action="delete"
                            title="<?= e(t('notes.delete')) ?>" aria-label="<?= e(t('notes.delete')) ?>">
                        <?= icon('trash') ?>
                    </button>
                </div>
            </article>
        </template>
    </aside>

    <button type="button" class="notes-backdrop" data-notes-backdrop hidden
            aria-label="<?= e(t('notes.hide')) ?>"></button>

    <main class="editor-shell" id="main">
        <div class="document-tabs-bar">
            <div class="document-tabs" id="documentTabs" role="tablist"
                 aria-label="<?= e(t('notes.tabs_label')) ?>"></div>
            <button type="button" class="document-tabs__new" data-action="new"
                    title="<?= e(t('notes.new')) ?>" aria-label="<?= e(t('notes.new')) ?>">
                <?= icon('plus') ?>
            </button>
        </div>

        <template id="documentTabTemplate">
            <div class="document-tab" role="presentation">
                <button type="button" class="document-tab__main" data-tab-action="open"
                        role="tab" aria-selected="false" tabindex="-1">
                    <?= icon('file') ?>
                    <span class="document-tab__title" dir="auto"></span>
                    <span class="document-tab__dirty" aria-hidden="true"></span>
                </button>
                <button type="button" class="document-tab__close" data-tab-action="close"
                        title="<?= e(t('notes.close_tab')) ?>" aria-label="<?= e(t('notes.close_tab')) ?>">
                    <?= icon('close') ?>
                </button>
            </div>
        </template>

        <div class="document-header">
            <button type="button" class="document-header__notes" data-action="toggle-notes"
                    aria-expanded="false" aria-controls="notesSidebar"
                    title="<?= e(t('notes.show')) ?>" aria-label="<?= e(t('notes.show')) ?>">
                <?= icon('sidebar') ?>
            </button>
            <label class="document-title">
                <span class="visually-hidden"><?= e(t('notes.title_label')) ?></span>
                <input type="text" class="document-title__input" id="noteTitle" maxlength="120"
                       aria-label="<?= e(t('notes.title_label')) ?>" autocomplete="off" spellcheck="false"
                       placeholder="<?= e(t('notes.untitled')) ?>">
            </label>
            <div class="document-organization">
                <div class="document-folder" id="documentFolderPicker">
                    <button type="button" class="document-folder__trigger" id="noteFolder"
                            aria-label="<?= e(t('notes.folder_label')) ?>"
                            aria-haspopup="listbox" aria-expanded="false" aria-controls="noteFolderOptions">
                        <?= icon('folder', ['class' => 'icon document-folder__icon']) ?>
                        <span class="document-folder__value" id="noteFolderValue"><?= e(t('notes.no_folder')) ?></span>
                        <?= icon('chevron-down', ['class' => 'icon document-folder__chevron']) ?>
                    </button>
                    <div class="document-folder__menu" id="noteFolderMenu" hidden>
                        <div class="document-folder__menu-label"><?= e(t('notes.folder_menu')) ?></div>
                        <div class="document-folder__options" id="noteFolderOptions" role="listbox"
                             aria-label="<?= e(t('notes.folder_menu')) ?>"></div>
                    </div>
                </div>
                <div class="document-tags" id="currentNoteTags"></div>
                <button type="button" class="document-tags__manage" data-action="manage-note-tags"
                        title="<?= e(t('notes.manage_tags')) ?>" aria-label="<?= e(t('notes.manage_tags')) ?>">
                    <?= icon('tag') ?>
                    <span><?= e(t('notes.tags')) ?></span>
                </button>
            </div>
        </div>

        <div class="toolbar" id="toolbar" data-toolbar-context="base" role="toolbar" aria-label="<?= e(t('toolbar.group_format')) ?>" aria-controls="editor">

        <div class="toolbar__pane" id="toolbarPaneBase" data-toolbar-pane="base">
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
        </div><!-- /toolbarPaneBase -->

        <div class="toolbar__pane" id="toolbarPaneTable" data-toolbar-pane="table" hidden>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('table.group_rows')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="row-above"
                        title="<?= e(t('table.row_above')) ?>" aria-label="<?= e(t('table.row_above')) ?>">
                    <?= icon('table-row-above') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="row-below"
                        title="<?= e(t('table.row_below')) ?>" aria-label="<?= e(t('table.row_below')) ?>">
                    <?= icon('table-row-below') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="row-delete"
                        title="<?= e(t('table.row_delete')) ?>" aria-label="<?= e(t('table.row_delete')) ?>">
                    <?= icon('table-row-delete') ?>
                </button>
            </div>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('table.group_columns')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="col-left"
                        title="<?= e(t('table.col_left')) ?>" aria-label="<?= e(t('table.col_left')) ?>">
                    <?= icon('table-col-left') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="col-right"
                        title="<?= e(t('table.col_right')) ?>" aria-label="<?= e(t('table.col_right')) ?>">
                    <?= icon('table-col-right') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="col-delete"
                        title="<?= e(t('table.col_delete')) ?>" aria-label="<?= e(t('table.col_delete')) ?>">
                    <?= icon('table-col-delete') ?>
                </button>
            </div>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('table.group_cells')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="merge"
                        title="<?= e(t('table.merge')) ?>" aria-label="<?= e(t('table.merge')) ?>">
                    <?= icon('table-merge') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="split"
                        title="<?= e(t('table.split')) ?>" aria-label="<?= e(t('table.split')) ?>">
                    <?= icon('table-split') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="clear-cells"
                        title="<?= e(t('table.clear_cells')) ?>" aria-label="<?= e(t('table.clear_cells')) ?>">
                    <?= icon('table-clear') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="select-table"
                        title="<?= e(t('table.select_table')) ?>" aria-label="<?= e(t('table.select_table')) ?>">
                    <?= icon('table-select') ?>
                </button>
            </div>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('table.group_headers')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="header-row" aria-pressed="false"
                        title="<?= e(t('table.header_row')) ?>" aria-label="<?= e(t('table.header_row')) ?>">
                    <?= icon('table-header-row') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="header-col" aria-pressed="false"
                        title="<?= e(t('table.header_column')) ?>" aria-label="<?= e(t('table.header_column')) ?>">
                    <?= icon('table-header-col') ?>
                </button>
            </div>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('toolbar.group_align')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="align-left"
                        title="<?= e(t('toolbar.align_left')) ?>" aria-label="<?= e(t('toolbar.align_left')) ?>">
                    <?= icon('align-left') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="align-center"
                        title="<?= e(t('toolbar.align_center')) ?>" aria-label="<?= e(t('toolbar.align_center')) ?>">
                    <?= icon('align-center') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="align-right"
                        title="<?= e(t('toolbar.align_right')) ?>" aria-label="<?= e(t('toolbar.align_right')) ?>">
                    <?= icon('align-right') ?>
                </button>
            </div>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('table.group_vertical')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="v-align-top"
                        title="<?= e(t('table.v_align_top')) ?>" aria-label="<?= e(t('table.v_align_top')) ?>">
                    <?= icon('align-vert-top') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="v-align-middle"
                        title="<?= e(t('table.v_align_middle')) ?>" aria-label="<?= e(t('table.v_align_middle')) ?>">
                    <?= icon('align-vert-middle') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="v-align-bottom"
                        title="<?= e(t('table.v_align_bottom')) ?>" aria-label="<?= e(t('table.v_align_bottom')) ?>">
                    <?= icon('align-vert-bottom') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="cell-dir-ltr"
                        title="<?= e(t('table.cell_dir_ltr')) ?>" aria-label="<?= e(t('table.cell_dir_ltr')) ?>">
                    <?= icon('dir-ltr') ?>
                </button>
                <button type="button" class="toolbar__btn" data-table-action="cell-dir-rtl"
                        title="<?= e(t('table.cell_dir_rtl')) ?>" aria-label="<?= e(t('table.cell_dir_rtl')) ?>">
                    <?= icon('dir-rtl') ?>
                </button>
            </div>
            <div class="toolbar__group" role="group" aria-label="<?= e(t('table.group_colour')) ?>">
                <button type="button" class="toolbar__btn" data-table-action="cell-colour"
                        title="<?= e(t('table.cell_colour')) ?>" aria-label="<?= e(t('table.cell_colour')) ?>">
                    <?= icon('palette') ?>
                </button>
            </div>
            <div class="menu menu--toolbar" id="tableMoreMenu">
                <button type="button" class="menu__trigger toolbar__btn" id="tableMoreTrigger"
                        aria-haspopup="true" aria-expanded="false" aria-controls="tableMorePanel"
                        title="<?= e(t('table.more')) ?>" aria-label="<?= e(t('table.more')) ?>">
                    <?= icon('more', ['class' => 'icon']) ?>
                </button>
                <div class="menu__panel menu__panel--table" id="tableMorePanel" role="menu"
                     aria-labelledby="tableMoreTrigger" data-open="false">
                    <button type="button" class="menu__item" role="menuitem" data-table-action="properties">
                        <?= icon('table-properties') ?><span><?= e(t('table.properties')) ?></span>
                    </button>
                    <button type="button" class="menu__item" role="menuitem" data-table-action="borders">
                        <?= icon('table-borders') ?><span><?= e(t('table.borders')) ?></span>
                    </button>
                    <button type="button" class="menu__item" role="menuitem" data-table-action="sort-asc">
                        <?= icon('sort-asc') ?><span><?= e(t('table.sort_asc')) ?></span>
                    </button>
                    <button type="button" class="menu__item" role="menuitem" data-table-action="sort-desc">
                        <?= icon('sort-desc') ?><span><?= e(t('table.sort_desc')) ?></span>
                    </button>
                    <div class="menu__separator" role="separator"></div>
                    <button type="button" class="menu__item" role="menuitem" data-table-action="move-row-up">
                        <?= icon('table-move-up') ?><span><?= e(t('table.move_row_up')) ?></span>
                    </button>
                    <button type="button" class="menu__item" role="menuitem" data-table-action="move-row-down">
                        <?= icon('table-move-down') ?><span><?= e(t('table.move_row_down')) ?></span>
                    </button>
                    <div class="menu__separator" role="separator"></div>
                    <button type="button" class="menu__item menu__item--danger" role="menuitem" data-table-action="delete-table">
                        <?= icon('table-delete') ?><span><?= e(t('table.delete_table')) ?></span>
                    </button>
                </div>
            </div>
        </div><!-- /toolbarPaneTable -->

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
        <div class="findbar__options" role="group" aria-label="<?= e(t('find.label')) ?>">
            <button type="button" class="findbar__toggle" data-find-option="case"
                    aria-pressed="false" title="<?= e(t('find.case_sensitive')) ?>">
                <span class="findbar__toggle-symbol" aria-hidden="true">Aa</span>
                <span><?= e(t('find.case_sensitive')) ?></span>
            </button>
            <button type="button" class="findbar__toggle" data-find-option="whole"
                    aria-pressed="false" title="<?= e(t('find.whole_word')) ?>">
                <span class="findbar__toggle-symbol" aria-hidden="true">ab</span>
                <span><?= e(t('find.whole_word')) ?></span>
            </button>
            <button type="button" class="findbar__toggle" data-find-option="regex"
                    aria-pressed="false" title="<?= e(t('find.regular_expression')) ?>">
                <span class="findbar__toggle-symbol findbar__toggle-symbol--code" aria-hidden="true">.*</span>
                <span><?= e(t('find.regular_expression')) ?></span>
            </button>
            <button type="button" class="findbar__toggle" data-find-option="selection"
                    aria-pressed="false" title="<?= e(t('find.in_selection')) ?>" hidden>
                <?= icon('select-all', ['class' => 'icon']) ?>
                <span><?= e(t('find.in_selection')) ?></span>
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

    <div class="image-block-toolbar" id="imageBlockToolbar" role="toolbar"
         aria-label="<?= e(t('image.toolbar_label')) ?>" aria-controls="editor" hidden>
        <button type="button" class="image-block-toolbar__btn" data-image-action="replace"
                title="<?= e(t('image.replace')) ?>" aria-label="<?= e(t('image.replace')) ?>">
            <?= icon('image-replace') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn" data-image-action="layout-start"
                title="<?= e(t('image.layout_start')) ?>" aria-label="<?= e(t('image.layout_start')) ?>" aria-pressed="false">
            <?= icon('align-left') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn" data-image-action="layout-center"
                title="<?= e(t('image.layout_center')) ?>" aria-label="<?= e(t('image.layout_center')) ?>" aria-pressed="false">
            <?= icon('align-center') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn" data-image-action="layout-end"
                title="<?= e(t('image.layout_end')) ?>" aria-label="<?= e(t('image.layout_end')) ?>" aria-pressed="false">
            <?= icon('align-right') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn" data-image-action="size"
                title="<?= e(t('image.size')) ?>" aria-label="<?= e(t('image.size')) ?>">
            <?= icon('image-size') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn" data-image-action="details"
                title="<?= e(t('image.edit')) ?>" aria-label="<?= e(t('image.edit')) ?>">
            <?= icon('image-alt') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn" data-image-action="crop"
                title="<?= e(t('image.crop')) ?>" aria-label="<?= e(t('image.crop')) ?>">
            <?= icon('crop') ?>
        </button>
        <button type="button" class="image-block-toolbar__btn image-block-toolbar__btn--danger" data-image-action="remove"
                title="<?= e(t('image.remove')) ?>" aria-label="<?= e(t('image.remove')) ?>">
            <?= icon('trash') ?>
        </button>
    </div>

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
</div>

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

<div class="table-context" id="tableContextMenu" role="menu"
     aria-label="<?= e(t('table.context_menu')) ?>" hidden></div>


<dialog class="dialog backup-dialog" id="backupDialog" aria-labelledby="backupDialogTitle">
    <div class="dialog__header">
        <h2 class="dialog__title" id="backupDialogTitle"><?= e(t('backups.title')) ?></h2>
        <button type="button" class="dialog__close" data-backup-action="close"
                aria-label="<?= e(t('dialog.close')) ?>">
            <?= icon('close') ?>
        </button>
    </div>
    <div class="dialog__body backup-recovery">
        <p class="backup-recovery__intro"><?= e(t('backups.intro')) ?></p>
        <div class="backup-recovery__toolbar">
            <span class="backup-recovery__count" id="backupCount" aria-live="polite"></span>
            <button type="button" class="backup-recovery__clear" data-backup-action="clear" hidden>
                <?= icon('trash') ?>
                <span><?= e(t('backups.clear')) ?></span>
            </button>
        </div>
        <div class="backup-list" id="backupList"></div>
        <div class="backup-empty" id="backupEmpty" hidden>
            <?= icon('undo') ?>
            <p><?= e(t('backups.empty')) ?></p>
        </div>
        <p class="backup-recovery__privacy"><?= icon('lock') ?> <?= e(t('backups.privacy')) ?></p>
    </div>
    <div class="dialog__footer">
        <button type="button" class="btn btn--primary" data-backup-action="close">
            <?= e(t('dialog.close')) ?>
        </button>
    </div>
</dialog>

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
