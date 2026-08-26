/**
 * End-to-end coverage for the table feature: Insert menu -> settings dialog
 * -> table in the editor -> contextual toolbar -> full cell control.
 *
 * The behaviour suite loads the same page but its checks are synchronous, so
 * the asynchronous dialog continuations (promise resolutions) cannot be
 * asserted mid-checks. This suite boots its own copy of the page and awaits
 * explicitly, flushing only microtasks (no timers), which is why it can
 * sequence everything deterministically.
 */

import { PHP } from '@php-wasm/universal';
import { loadNodeRuntime } from '@php-wasm/node';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function renderIndex() {
    const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 3 } });
    const php = new PHP(rt);
    (function mirror(host, vfs) {
        php.mkdir(vfs);
        for (const entry of fs.readdirSync(host, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests'].includes(entry.name)) continue;
            const h = path.join(host, entry.name);
            const v = `${vfs}/${entry.name}`;
            if (entry.isDirectory()) mirror(h, v);
            else php.writeFile(v, fs.readFileSync(h));
        }
    })(ROOT, '/site');

    const result = await php.run({
        scriptPath: '/site/index.php',
        $_SERVER: { REQUEST_METHOD: 'GET', REQUEST_URI: '/', HTTP_HOST: 'npad.ir', HTTPS: 'on' },
    });
    return result.text;
}

function installEnvironment(dom) {
    const { window } = dom;
    window.indexedDB = undefined;
    window.matchMedia = window.matchMedia || ((q) => ({
        matches: false, media: q, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
    }));
    if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        window.HTMLDialogElement.prototype.close = function () {
            this.open = false;
            this.dispatchEvent(new window.Event('close'));
        };
    }
    window.navigator.sendBeacon = () => true;
    document.execCommand = document.execCommand || (() => true);
    // Attachment rendering resolves Blobs to object URLs; give jsdom a stub.
    window.URL = window.URL || {};
    if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = () => 'blob:https://npad.ir/mock';
        window.URL.revokeObjectURL = () => {};
    }
}

export default async function run(check, group) {
    const html = await renderIndex();
    const virtualConsole = new VirtualConsole();
    const consoleErrors = [];
    virtualConsole.on('jsdomError', (e) => consoleErrors.push(e.message));
    virtualConsole.on('error', (m) => consoleErrors.push(String(m)));

    const dom = new JSDOM(html, {
        url: 'https://npad.ir/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole,
    });

    const { window } = dom;
    global.window = window;
    global.document = window.document;
    global.HTMLElement = window.HTMLElement;
    global.Node = window.Node;
    global.Event = window.Event;
    global.localStorage = window.localStorage;
    global.indexedDB = undefined;
    Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
    installEnvironment(dom);

    const url = (p) => pathToFileURL(path.join(ROOT, p)).href + `?t=${Date.now()}`;
    const { initMenus } = await import(url('assets/js/ui.js'));
    const { initTheme } = await import(url('assets/js/theme.js'));
    const { initEditor } = await import(url('assets/js/editor.js'));

    initMenus();
    initTheme({ onChange: () => {} });
    const tracked = [];
    initEditor({
        strings: JSON.parse(document.getElementById('i18n').textContent),
        onEvent: (e) => tracked.push(e),
    });

    // Let the asynchronous note boot (IndexedDB fallback) finish.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const editor = document.getElementById('editor');
    const dialog = document.getElementById('appDialog');
    const insertMenuTrigger = document.getElementById('insertMenuTrigger');
    const insertMenuPanel = document.getElementById('insertMenuPanel');
    const tablePaneBase = document.getElementById('toolbarPaneBase');
    const tablePaneTable = document.getElementById('toolbarPaneTable');
    const contextMenu = document.getElementById('tableContextMenu');
    const flush = () => new Promise((resolve) => queueMicrotask(resolve));

    const click = (target) => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const clickMenu = (action) => {
        click(insertMenuTrigger);
        click(insertMenuPanel.querySelector(`[data-action="${action}"]`));
    };
    const clickTool = (action) => {
        click(tablePaneTable.querySelector(`[data-table-action="${action}"]`));
    };
    const putCaretInCell = (node, atEnd = false) => {
        const range = document.createRange();
        if (atEnd) { range.selectNodeContents(node); range.collapse(false); }
        else { range.setStart(node, 0); range.collapse(true); }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    };
    const bordersOff = (table) => {
        const cell = table.querySelector('td, th');
        const width = Number.parseFloat(cell?.style?.getPropertyValue('border-width'));
        return Number.isFinite(width) && width === 0;
    };

    group('tables-ui: end-to-end');

    // The harness check() does not await async fns, so this suite reports its
    // own pass/fail per step (each awaited) and funnels a single summary into
    // the harness at the end.
    const steps = [];
    let stepFailures = [];
    const step = async (name, fn) => {
        try {
            await fn();
            console.log(`  ok    ${name}`);
            steps.push(name);
        } catch (err) {
            stepFailures.push(name);
            console.log(`  FAIL  ${name}`);
            console.log(`        ${String(err.message).split('\n')[0]}`);
        }
    };


    await step('Insert menu -> dialog -> table appears with the toolbar swapped', async () => {
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaretInCell(editor.querySelector('p:last-child'));
        clickMenu('insert-table');
        assert.equal(dialog.open, true, 'settings dialog did not open');

        const body = dialog.querySelector('.dialog__body');
        body.querySelector('[data-table-rows]').value = '3';
        body.querySelector('[data-table-cols]').value = '4';
        body.querySelector('[data-table-check="headerRow"]').checked = true;
        body.querySelector('[data-table-check="headerColumn"]').checked = true;
        body.querySelector('[data-table-rows]').dispatchEvent(new window.Event('input', { bubbles: true }));
        body.querySelector('[data-table-check="headerRow"]').dispatchEvent(new window.Event('change', { bubbles: true }));
        click(dialog.querySelector('[data-action="insert"]'));
        await flush();

        const table = editor.querySelector('table');
        assert.ok(table, 'table not inserted');
        assert.equal(table.rows.length, 3, 'row count');
        assert.equal(table.rows[0].cells.length, 4, 'column count');
        assert.ok(table.tHead, 'header row missing');
        assert.equal(table.tBodies[0].rows[0].cells[0].tagName, 'TH', 'header column missing');
        assert.equal(table.tBodies[0].rows[0].cells[0].getAttribute('scope'), 'row');
        assert.equal(tablePaneBase.hidden, true, 'base toolbar still visible');
        assert.equal(tablePaneTable.hidden, false, 'table toolbar not shown');
        assert.ok(tracked.includes('table_inserted'), 'table_inserted not tracked');
    });

    await step('row and column controls update the grid', () => {
        const table = editor.querySelector('table');
        clickTool('row-below');
        assert.equal(table.rows.length, 4);
        clickTool('row-above');
        assert.equal(table.rows.length, 5);
        clickTool('col-right');
        assert.equal(table.rows[0].cells.length, 5);
        clickTool('row-delete');
        assert.equal(table.rows.length, 4);
        clickTool('col-delete');
        assert.equal(table.rows[0].cells.length, 4);
        assert.ok(tracked.includes('table_tool_used'), 'table_tool_used not tracked');
    });

    await step('merge works even when clicking the toolbar collapses the selection', () => {
        const table = editor.querySelector('table');
        const body = table.tBodies[0];
        const [first, second] = [...body.rows[0].cells].slice(0, 2);
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(second, 0);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        // selectionchange saves the range (as in a real browser); then the
        // toolbar button click moves focus and collapses the selection.
        document.dispatchEvent(new window.Event('selectionchange'));
        selection.removeAllRanges();
        clickTool('merge');
        const merged = body.rows[0].cells[0];
        assert.equal(merged.getAttribute('colspan'), '2', 'merge lost the collapsed selection');
        clickTool('split');
        assert.equal(body.rows[0].cells[0].getAttribute('colspan'), null, 'split did not restore cells');
    });

    await step('Tab appends a row and Shift+Tab steps back', () => {
        const table = editor.querySelector('table');
        const cells = [...table.querySelectorAll('td, th')].filter((c) => c.closest('table') === table);
        putCaretInCell(cells[cells.length - 1], true);
        const before = table.rows.length;
        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        assert.equal(table.rows.length, before + 1);
        editor.dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
        }));
        assert.ok(window.getSelection().anchorNode);
    });

    await step('properties dialog applies caption, width and borders', async () => {
        const table = editor.querySelector('table');
        clickTool('properties');
        assert.equal(dialog.open, true, 'properties dialog did not open');
        dialog.querySelector('[data-prop-caption]').value = 'My data';
        dialog.querySelector('[data-prop-width]').value = 'full';
        dialog.querySelector('[data-prop-borders]').checked = false;
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        assert.equal(table.querySelector(':scope > caption')?.textContent, 'My data');
        assert.equal(table.getAttribute('style'), 'width: 100%;');
        assert.equal(bordersOff(table), true, 'borders were not removed');
    });

    await step('cell colour paints the selected cells from the dialog', async () => {
        const table = editor.querySelector('table');
        const target = table.tBodies[0].rows[0].cells[0];
        putCaretInCell(target, true);
        document.dispatchEvent(new window.Event('selectionchange'));
        clickTool('cell-colour');
        assert.equal(dialog.open, true, 'colour dialog did not open');
        click(dialog.querySelector('[data-preset="#dc2626"]'));
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        assert.ok(/background-color/.test(target.getAttribute('style') || ''), 'cell not shaded');
        assert.ok(tracked.includes('table_tool_used'), 'table_tool_used not tracked');
    });

    await step('select table selects the whole table and keeps table tools', () => {
        editor.innerHTML = '<table><tbody><tr><td>x</td><td>y</td></tr>'
            + '<tr><td>z</td><td>w</td></tr></tbody></table><p><br></p>';
        const table = editor.querySelector('table');
        putCaretInCell(table.tBodies[0].rows[0].cells[0], true);
        document.dispatchEvent(new window.Event('selectionchange'));
        clickTool('select-table');

        assert.ok(table.classList.contains('npad-table-selected'), 'whole table not marked selected');
        assert.equal(tablePaneTable.hidden, false, 'table tools lost after selecting the table');
        // Any new pointer interaction ends the whole-table selection.
        document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
        assert.equal(table.classList.contains('npad-table-selected'), false, 'selection not cleared on pointerdown');
    });

    await step('sorting a column reorders the body rows', () => {
        editor.innerHTML = '<table><thead><tr><th>Name</th><th>Value</th></tr></thead>'
            + '<tbody><tr><td>b</td><td>2</td></tr><tr><td>a</td><td>1</td></tr>'
            + '<tr><td>c</td><td>3</td></tr></tbody></table><p><br></p>';
        const table = editor.querySelector('table');
        putCaretInCell(table.tBodies[0].rows[0].cells[0], true);
        document.dispatchEvent(new window.Event('selectionchange'));
        click(document.getElementById('tableMorePanel')
            .querySelector('[data-table-action="sort-asc"]'));

        const names = [...table.tBodies[0].rows].map((row) => row.cells[0].textContent);
        assert.deepEqual(names, ['a', 'b', 'c'], 'rows not sorted');
    });

    await step('deleting the last row asks to delete the table instead', async () => {
        editor.innerHTML = '<table><tbody><tr><td>only</td><td>row</td></tr></tbody></table><p><br></p>';
        const table = editor.querySelector('table');
        putCaretInCell(table.tBodies[0].rows[0].cells[0], true);
        document.dispatchEvent(new window.Event('selectionchange'));
        clickTool('row-delete');

        assert.equal(dialog.open, true, 'last-row delete did not ask for confirmation');
        assert.ok(dialog.querySelector('[data-action="confirm"]'), 'no confirm button');
        click(dialog.querySelector('[data-action="confirm"]'));
        await flush();

        assert.equal(editor.querySelector('table'), null, 'table not deleted after confirm');
        assert.equal(tablePaneBase.hidden, false, 'base toolbar not restored');
    });

    await step('deleting the table restores the base toolbar', async () => {
        editor.innerHTML = '<table><tbody><tr><td>x</td></tr></tbody></table><p><br></p>';
        putCaretInCell(editor.querySelector('td'), true);
        document.dispatchEvent(new window.Event('selectionchange'));
        clickTool('delete-table');
        assert.equal(dialog.open, true, 'delete confirmation did not open');
        click(dialog.querySelector('[data-action="confirm"]'));
        await flush();

        assert.equal(editor.querySelector('table'), null, 'table still present');
        assert.equal(tablePaneTable.hidden, true, 'table toolbar still visible');
        assert.equal(tablePaneBase.hidden, false, 'base toolbar not restored');
    });

    await step('horizontal rule inserts from the menu', () => {
        putCaretInCell(editor, true);
        clickMenu('insert-hr');
        assert.ok(editor.querySelector('hr'), 'hr not inserted');
    });

    await step('inserting a table from inside a cell places it beside the current table', async () => {
        editor.innerHTML = '<p>pre</p><table><tbody><tr><td>x</td><td>y</td></tr></tbody></table><p><br></p>';
        document.dispatchEvent(new window.Event('selectionchange'));
        const first = editor.querySelector('table');
        putCaretInCell(first.tBodies[0].rows[0].cells[0], true);
        document.dispatchEvent(new window.Event('selectionchange'));
        clickMenu('insert-table');
        const body = dialog.querySelector('.dialog__body');
        body.querySelector('[data-table-rows]').value = '2';
        body.querySelector('[data-table-cols]').value = '2';
        body.querySelector('[data-table-rows]').dispatchEvent(new window.Event('input', { bubbles: true }));
        click(dialog.querySelector('[data-action="insert"]'));
        await flush();

        const tables = [...editor.querySelectorAll('table')];
        assert.equal(tables.length, 2, 'second table not created');
        const second = tables[1];
        assert.equal(second.parentNode, editor, 'new table nested inside another table or cell');
        assert.equal(first.contains(second), false, 'new table is a child of the first table');
        // Clean up: the context-menu step rebuilds the DOM anyway.
    });

    await step('right-click context menu opens, acts and closes', () => {
        editor.innerHTML = '<p>pre</p><table><tbody><tr><td>x</td><td>y</td></tr></tbody></table><p><br></p>';
        const cell = editor.querySelector('td');
        putCaretInCell(cell, true);
        document.dispatchEvent(new window.Event('selectionchange'));
        cell.dispatchEvent(new window.MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 10, clientY: 10,
        }));
        assert.equal(contextMenu.hidden, false, 'context menu did not open');
        const tableBefore = editor.querySelector('table').rows.length;
        click(contextMenu.querySelector('[data-table-action="row-below"]'));
        assert.equal(editor.querySelector('table').rows.length, tableBefore + 1, 'context menu action did not run');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(contextMenu.hidden, true, 'Escape did not close the menu');
    });

    /* --------------------------------------------------------------------
       Images & attachments end-to-end
       -------------------------------------------------------------------- */

    const storageMod = await import(url('assets/js/storage.js'));
    const imagePane = document.getElementById('toolbarPaneImage');
    const imageContextMenuEl = document.getElementById('imageContextMenu');
    const pngFile = () => new dom.window.File(
        [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'shot.png',
        { type: 'image/png' },
    );
    const pasteImage = async (file) => {
        const event = new window.Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
            value: {
                getData: () => '',
                files: [file],
                items: [{ getAsFile: () => file }],
            },
        });
        editor.dispatchEvent(event);
        // handleContentData is async and awaits the attachment store.
        await new Promise((resolve) => window.setTimeout(resolve, 40));
    };

    await step('pasting an image archives it and inserts a reference', async () => {
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaretInCell(editor.querySelector('p:last-child'));
        await pasteImage(pngFile());

        const img = editor.querySelector('img[data-npad-img]');
        assert.ok(img, 'pasted image reference missing');
        assert.ok(img.getAttribute('data-npad-img').startsWith('img-'), 'id is not note-bound');
        assert.equal(img.getAttribute('alt'), 'shot.png');
        assert.ok(img.getAttribute('src') || img.classList.contains('npad-img-missing'), 'payload not resolved');
        // The blob is really stored (fallback localStorage in jsdom).
        const noteId = storageMod.getActiveNoteId();
        const owned = await storageMod.listImagesByNote(noteId);
        assert.equal(owned.length, 1, 'attachment not persisted');
    });

    await step('clicking the image swaps to the image toolbar', () => {
        const img = editor.querySelector('img[data-npad-img]');
        img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        assert.ok(img.classList.contains('npad-img-selected'), 'image not selected');
        assert.equal(imagePane.hidden, false, 'image pane not shown');
        assert.equal(document.getElementById('toolbarPaneBase').hidden, true);
        assert.ok(imagePane.querySelector('[data-image-action="advanced"]'), 'advanced properties action missing');
        assert.ok(imagePane.querySelector('[data-image-action="rotate-ccw"]'), 'rotate action missing');
        assert.ok(imagePane.querySelector('[data-image-action="layout-wrap"]'), 'wrap toggle action missing');
        assert.ok(imagePane.querySelector('[data-image-action="recolor-grayscale"]'), 'recolor action missing');
        assert.ok(imagePane.querySelector('[data-image-action="remove-image"]'), 'remove action missing');
    });

    await step('size, alignment and the properties dialog edit the image', async () => {
        const img = editor.querySelector('img[data-npad-img]');
        click(imagePane.querySelector('[data-image-action="size-medium"]'));
        assert.ok(/width:50%/.test(img.getAttribute('style') || ''), 'size not applied');

        click(imagePane.querySelector('[data-image-action="align-center"]'));
        assert.equal(img.closest('figure').getAttribute('data-npad-figure'), '', 'figure not created for alignment');

        click(imagePane.querySelector('[data-image-action="advanced"]'));
        assert.equal(dialog.open, true, 'image dialog did not open');
        dialog.querySelector('[data-image-alt]').value = 'A screenshot';
        dialog.querySelector('[data-image-caption]').value = 'Step one';
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        assert.equal(img.getAttribute('alt'), 'A screenshot');
        assert.equal(img.closest('figure').querySelector('figcaption')?.textContent, 'Step one');
    });

    await step('removing the image returns to the base toolbar', () => {
        const img = editor.querySelector('img[data-npad-img]');
        img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        click(imagePane.querySelector('[data-image-action="remove-image"]'));
        assert.equal(editor.querySelector('img[data-npad-img]'), null, 'image still present');
        assert.equal(imagePane.hidden, true, 'image pane still shown');
        assert.equal(document.getElementById('toolbarPaneBase').hidden, false, 'base toolbar not restored');
    });

    await step('orphaned attachments are garbage-collected on autosave', async () => {
        // The removed image's blob must disappear after the note is saved.
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const noteId = storageMod.getActiveNoteId();
        const owned = await storageMod.listImagesByNote(noteId);
        assert.equal(owned.length, 0, 'orphaned attachment still stored');
    });

    await step('unsupported and oversized images are rejected with a toast', async () => {
        editor.innerHTML = '<p><br></p>';
        putCaretInCell(editor.querySelector('p'), true);
        const svg = new dom.window.File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
        await pasteImage(svg);
        assert.equal(editor.querySelector('img[data-npad-img]'), null, 'svg image inserted');
        const big = pngFile();
        Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
        await pasteImage(big);
        assert.equal(editor.querySelector('img[data-npad-img]'), null, 'oversized image inserted');
        assert.ok(document.querySelectorAll('.toast').length >= 1, 'no rejection toast shown');
    });

    await step('Insert menu offers Image… and archives a picked file', async () => {
        let picked = '';
        const nativeClick = window.HTMLInputElement.prototype.click;
        window.HTMLInputElement.prototype.click = function () {
            if (this.type === 'file' && this.accept.includes('image/')) {
                picked = this.accept;
                Object.defineProperty(this, 'files', { value: [pngFile()], configurable: true });
                this.dispatchEvent(new window.Event('change'));
            } else {
                nativeClick.call(this);
            }
        };
        try {
            clickMenu('insert-image');
        } finally {
            window.HTMLInputElement.prototype.click = nativeClick;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        assert.ok(picked.includes('image/png'), 'picker not restricted to images');
        assert.ok(editor.querySelector('img[data-npad-img]'), 'picked image not inserted');
    });

    /* --------------------------------------------------------------------
       Image object model end-to-end
       -------------------------------------------------------------------- */

    const readProps = (img) => JSON.parse(img.getAttribute('data-npad-props') || '{}');

    await step('advanced dialog applies wrap layout, rotation and adjustments', async () => {
        const img = editor.querySelector('img[data-npad-img]');
        img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        click(imagePane.querySelector('[data-image-action="advanced"]'));
        assert.equal(dialog.open, true, 'properties dialog did not open');

        const wrap = dialog.querySelector('input[name="data-image-layout"][value="wrap-left"]');
        wrap.checked = true;
        wrap.dispatchEvent(new window.Event('change', { bubbles: true }));
        const rotate = dialog.querySelector('[data-image-props="rotate"]');
        rotate.value = '30';
        rotate.dispatchEvent(new window.Event('input', { bubbles: true }));
        const opacity = dialog.querySelector('[data-image-props="opacity"]');
        opacity.value = '60';
        opacity.dispatchEvent(new window.Event('input', { bubbles: true }));
        const recolor = dialog.querySelector('[data-image-props="recolor"]');
        recolor.value = 'sepia';
        recolor.dispatchEvent(new window.Event('change', { bubbles: true }));
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        const props = readProps(img);
        assert.equal(props.layout, 'wrap-left', 'layout not applied');
        assert.equal(props.rotate, 30, 'rotation not applied');
        assert.equal(props.opacity, 60, 'opacity not applied');
        assert.equal(props.recolor, 'sepia', 'recolor not applied');
        assert.match(img.closest('figure').getAttribute('style'), /float:\s*left/);
        assert.match(img.getAttribute('style'), /filter:/);
        assert.match(img.getAttribute('style'), /filter:/);
        assert.match(img.getAttribute('style'), /rotate\(30deg\)/);
    });

    await step('crop sliders build a clipped frame and persist', async () => {
        const img = editor.querySelector('img[data-npad-img]');
        img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        click(imagePane.querySelector('[data-image-action="advanced"]'));
        const left = dialog.querySelector('[data-image-props="crop.l"]');
        left.value = '10';
        left.dispatchEvent(new window.Event('input', { bubbles: true }));
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        const props = readProps(img);
        assert.equal(props.crop.l, 10, 'crop not applied');
        assert.ok(img.closest('[data-npad-frame-clip]'), 'crop frame missing');
        assert.match(img.getAttribute('style'), /object-fit:\s*cover/);
        assert.match(img.getAttribute('style'), /object-position:/);
    });

    await step('grayscale quick action toggles and rotate shortcut works', () => {
        const img = editor.querySelector('img[data-npad-img]');
        img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        click(imagePane.querySelector('[data-image-action="recolor-grayscale"]'));
        assert.equal(readProps(img).recolor, 'grayscale');
        click(imagePane.querySelector('[data-image-action="recolor-grayscale"]'));
        assert.equal(readProps(img).recolor, 'none');
        click(imagePane.querySelector('[data-image-action="rotate-ccw"]'));
        assert.equal(readProps(img).rotate, -60, 'rotate shortcut did not apply');
    });

    await step('behind-text layout is anchored and can be dragged with the pointer', async () => {
        const img = editor.querySelector('img[data-npad-img]');
        img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        click(imagePane.querySelector('[data-image-action="advanced"]'));
        const behind = dialog.querySelector('input[name="data-image-layout"][value="behind"]');
        behind.checked = true;
        behind.dispatchEvent(new window.Event('change', { bubbles: true }));
        const x = dialog.querySelector('[data-image-props-pos="x"]');
        x.value = '20';
        x.dispatchEvent(new window.Event('input', { bubbles: true }));
        const y = dialog.querySelector('[data-image-props-pos="y"]');
        y.value = '10';
        y.dispatchEvent(new window.Event('input', { bubbles: true }));
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        let props = readProps(img);
        assert.equal(props.layout, 'behind', 'behind layout not applied');
        assert.equal(props.pos.x, 20);
        assert.equal(props.pos.y, 10);
        const figure = img.closest('figure');
        assert.match(figure.getAttribute('style'), /position:\s*absolute/);
        assert.ok(figure.parentElement === editor
            || !!(figure.parentElement && figure.parentElement.closest('.editor')), 'not anchored in the note');

        // Simulate a pointer drag: +35px x, -12px y.
        img.dispatchEvent(new window.MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 100, clientY: 100,
        }));
        document.dispatchEvent(new window.MouseEvent('pointermove', {
            bubbles: true, cancelable: true, clientX: 135, clientY: 88,
        }));
        document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));

        const moved = readProps(img);
        assert.equal(moved.pos.x, 55, 'drag x not applied');
        assert.equal(moved.pos.y, -2, 'drag y not applied');
        assert.match(figure.getAttribute('style'), /left:\s*55px/);
        assert.match(figure.getAttribute('style'), /top:\s*-2px/);
    });

    await step('no uncaught page errors', () => {
        assert.deepEqual(consoleErrors, [], consoleErrors[0]);
    });

    check('all tables-ui steps pass', () => {
        assert.ok(stepFailures.length === 0, `failed: ${stepFailures.join(', ')}`);
    });

    // Let every pending page timer run while the window is still open —
    // autosave (800ms), spell remarks and toasts (4200ms) — because a timer
    // firing after window.close() crashes the process.
    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    window.close();
}
