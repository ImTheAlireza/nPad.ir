/**
 * Awaited end-to-end editor coverage: table interactions plus the semantic
 * image-block workflow (local insertion, description, contextual toolbar,
 * keyboard sizing, crop, resizing, and deletion).
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
    window.URL = window.URL || {};
    window.URL.createObjectURL = () => 'blob:https://npad.ir/mock-image';
    window.URL.revokeObjectURL = () => {};
    global.URL = window.URL;
    global.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
    window.HTMLCanvasElement.prototype.getContext = () => ({
        translate() {}, rotate() {}, drawImage() {},
    });
    window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob([Uint8Array.of(0)], { type: 'image/png' }));
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
            console.log(`        ${String(err.message).replace(/\n/g, '\n        ')}`);
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
       Image block: insertion, selection, keyboard-safe details and crop
       -------------------------------------------------------------------- */

    const pngBytes = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    ));
    const imageFile = () => {
        const blob = new Blob([pngBytes], { type: 'image/png' });
        Object.defineProperty(blob, 'name', { value: 'diagram.png' });
        return blob;
    };
    const pointerEvent = (type, pointerId, clientX, clientY) => {
        const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
        Object.defineProperty(event, 'pointerId', { value: pointerId });
        return event;
    };

    await step('Insert menu opens a local raster-only picker', () => {
        let accept = '';
        const nativeClick = window.HTMLInputElement.prototype.click;
        window.HTMLInputElement.prototype.click = function () {
            if (this.type === 'file') accept = this.accept;
            else nativeClick.call(this);
        };
        clickMenu('insert-image');
        window.HTMLInputElement.prototype.click = nativeClick;
        assert.match(accept, /image\/png/);
        assert.match(accept, /image\/avif/);
        assert.ok(!accept.includes('image/svg+xml'));
    });

    await step('Insert menu uses a semantic local image block and asks for a description', async () => {
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaretInCell(editor.querySelector('p:last-child'));
        const file = imageFile();
        const paste = new window.Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', {
            value: { getData: () => '', files: [file], items: [{ type: 'image/png', getAsFile: () => file }] },
        });
        editor.dispatchEvent(paste);
        await new Promise((resolve) => window.setTimeout(resolve, 40));

        const figure = editor.querySelector('figure[data-npad-image-block="1"]');
        assert.ok(figure, 'semantic figure missing');
        const image = figure.querySelector('img[data-npad-image-asset]');
        assert.ok(image, 'asset reference missing');
        assert.ok(image.getAttribute('data-npad-image-asset').startsWith('asset-'));
        assert.equal(image.getAttribute('src'), 'blob:https://npad.ir/mock-image');
        assert.equal(document.getElementById('toolbar').dataset.toolbarContext, 'base', 'main text toolbar was replaced');
        assert.equal(dialog.open, true, 'description dialog did not open');

        dialog.querySelector('[data-image-alt]').value = 'Blue diagram';
        dialog.querySelector('[data-image-caption]').value = 'Figure one';
        dialog.querySelector('[data-image-width]').value = '50';
        click(dialog.querySelector('[data-action="save-image-details"]'));
        await flush();

        const props = JSON.parse(figure.getAttribute('data-npad-image'));
        assert.deepEqual(props.alt, { kind: 'informative', text: 'Blue diagram' });
        assert.equal(props.caption, 'Figure one');
        assert.equal(props.display.widthPercent, 50);
        assert.equal(figure.querySelector('figcaption').textContent, 'Figure one');

        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const saved = JSON.parse(localStorage.getItem('npad:notes')).notes
            .find((note) => note.id === localStorage.getItem('npad:active-note'))?.html || '';
        assert.match(saved, /data-npad-image-block/);
        assert.ok(!/\ssrc=|npad-image-block--selected/.test(saved), saved);
    });

    await step('selection keeps the main toolbar stable and exposes a roving contextual toolbar', () => {
        const figure = editor.querySelector('figure[data-npad-image-block="1"]');
        figure.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        const imageToolbar = document.getElementById('imageBlockToolbar');
        assert.equal(imageToolbar.hidden, false, 'image toolbar not shown');
        assert.equal(imageToolbar.getAttribute('role'), 'toolbar');
        assert.equal(document.getElementById('toolbar').dataset.toolbarContext, 'base');
        const controls = [...imageToolbar.querySelectorAll('button')];
        assert.equal(controls.filter((button) => button.tabIndex === 0).length, 1, 'toolbar needs one tab stop');
        controls[0].focus();
        imageToolbar.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.notEqual(document.activeElement, controls[0], 'arrow navigation did not move in contextual toolbar');
    });

    await step('layout, keyboard size fields and crop apply through explicit dialogs', async () => {
        const figure = editor.querySelector('figure[data-npad-image-block="1"]');
        const imageToolbar = document.getElementById('imageBlockToolbar');
        click(imageToolbar.querySelector('[data-image-action="layout-center"]'));
        assert.equal(JSON.parse(figure.getAttribute('data-npad-image')).display.layout, 'center', 'center layout was not saved');

        click(imageToolbar.querySelector('[data-image-action="size"]'));
        assert.equal(dialog.open, true, 'size dialog did not open');
        assert.equal(document.activeElement, dialog.querySelector('[data-image-width]'),
            `size dialog focus landed on ${document.activeElement?.outerHTML || document.activeElement?.tagName}`);
        click(dialog.querySelector('[data-image-width-preset="75"]'));
        assert.equal(dialog.querySelector('[data-image-width]').value, '75');
        dialog.querySelector('[data-image-width]').value = '75';
        click(dialog.querySelector('[data-action="save-image-details"]'));
        await flush();
        assert.equal(JSON.parse(figure.getAttribute('data-npad-image')).display.widthPercent, 75, 'custom width was not saved');

        assert.ok(figure.hasAttribute('data-npad-image-selected'), 'image selection was lost before crop');
        click(imageToolbar.querySelector('[data-image-action="crop"]'));
        assert.equal(dialog.open, true, `crop dialog not opened: ${document.getElementById('toastRegion')?.textContent || ''}`);
        dialog.querySelector('[data-crop-field="x"]').value = '20';
        dialog.querySelector('[data-crop-field="x"]').dispatchEvent(new window.Event('input', { bubbles: true }));
        click(dialog.querySelector('[data-action="cancel"]'));
        await flush();
        assert.equal(JSON.parse(figure.getAttribute('data-npad-image')).crop, null, 'Cancel persisted a crop');

        click(imageToolbar.querySelector('[data-image-action="crop"]'));
        assert.equal(dialog.open, true, 'crop dialog did not reopen');
        dialog.querySelector('[data-crop-field="x"]').value = '10';
        dialog.querySelector('[data-crop-field="x"]').dispatchEvent(new window.Event('input', { bubbles: true }));
        dialog.querySelector('[data-crop-field="width"]').value = '80';
        dialog.querySelector('[data-crop-field="width"]').dispatchEvent(new window.Event('input', { bubbles: true }));
        click(dialog.querySelector('[data-action="apply-crop"]'));
        await flush();
        const crop = JSON.parse(figure.getAttribute('data-npad-image')).crop;
        assert.equal(crop.x, 10);
        assert.equal(crop.width, 80);

        click(imageToolbar.querySelector('[data-image-action="crop"]'));
        click(dialog.querySelector('[data-crop-rotate="cw"]'));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        click(dialog.querySelector('[data-action="apply-crop"]'));
        await flush();
        const rotated = JSON.parse(figure.getAttribute('data-npad-image'));
        assert.equal(rotated.rotation, 90, 'rotation was not saved');
        assert.deepEqual(rotated.crop, { x: 0, y: 10, width: 100, height: 80 });

        click(imageToolbar.querySelector('[data-image-action="details"]'));
        const decorative = dialog.querySelector('[data-image-decorative]');
        decorative.checked = true;
        decorative.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(dialog.querySelector('[data-image-alt]').disabled, true, 'decorative choice did not disable alt input');
        click(dialog.querySelector('[data-action="cancel"]'));
        await flush();
    });

    await step('desktop resize handles update width and Escape returns to ordinary editing', () => {
        const figure = editor.querySelector('figure[data-npad-image-block="1"]');
        const canvas = figure.querySelector('[data-npad-image-canvas]');
        editor.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500 });
        canvas.getBoundingClientRect = () => ({ left: 20, top: 40, width: 300, height: 160, right: 320, bottom: 200 });
        figure.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        const handle = document.querySelector('[data-image-resize-handle="se"]');
        assert.ok(handle, 'resize handle missing');
        handle.dispatchEvent(pointerEvent('pointerdown', 7, 100, 100));
        document.dispatchEvent(pointerEvent('pointermove', 7, 150, 100));
        document.dispatchEvent(pointerEvent('pointerup', 7, 150, 100));
        assert.ok(JSON.parse(figure.getAttribute('data-npad-image')).display.widthPercent > 75, 'resize did not increase width');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(document.getElementById('imageBlockToolbar').hidden, true, 'Escape did not dismiss image selection');
    });

    await step('Delete removes only the selected image block and its text flow remains editable', () => {
        const figure = editor.querySelector('figure[data-npad-image-block="1"]');
        figure.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        assert.equal(editor.querySelector('figure[data-npad-image-block="1"]'), null);
        assert.ok(editor.textContent.includes('before'));
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
