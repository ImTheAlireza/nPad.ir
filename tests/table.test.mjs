/**
 * Unit coverage for assets/js/table.js — the grid model and every structural
 * table operation. Runs in jsdom (no browser needed).
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!DOCTYPE html><body><div id="editor"></div></body>', { url: 'https://npad.ir/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const tableModule = await import(`file://${path.join(ROOT, 'assets/js/table.js')}`);

function mount(html) {
    const editor = document.getElementById('editor');
    editor.innerHTML = html;
    return editor.querySelector('table');
}

function cellCount(table) {
    return table.querySelectorAll('td, th').length;
}

export default function run(check, group) {
    group('table: creation');

    check('creates a plain table with the requested dimensions', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 4 }));
        assert.equal(table.rows.length, 3);
        assert.equal(table.rows[0].cells.length, 4);
        assert.equal(table.querySelectorAll('th').length, 0);
        assert.equal(table.querySelectorAll('td')[0].innerHTML, '<br>');
    });

    check('header row becomes thead with scoped th cells', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 2, headerRow: true }));
        assert.ok(table.tHead, 'missing thead');
        assert.equal(table.tHead.rows.length, 1);
        assert.equal(table.tBodies[0].rows.length, 2);
        assert.equal(table.tHead.rows[0].cells[0].tagName, 'TH');
        assert.equal(table.tHead.rows[0].cells[0].getAttribute('scope'), 'col');
    });

    check('header column becomes scoped row headers in body rows', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 3, headerColumn: true }));
        assert.equal(table.rows[1].cells[0].tagName, 'TH');
        assert.equal(table.rows[1].cells[0].getAttribute('scope'), 'row');
        assert.equal(table.rows[1].cells[1].tagName, 'TD');
    });

    group('table: grid model');

    check('grid resolves a merged 2x2 cell', () => {
        const table = mount('<table><tbody>'
            + '<tr><td rowspan="2" colspan="2">A</td></tr>'
            + '<tr></tr></tbody></table>');
        const { grid, colCount, startOf } = tableModule.tableGrid(table);
        assert.equal(colCount, 2);
        assert.equal(grid[0][0], table.rows[0].cells[0]);
        assert.equal(grid[1][0], table.rows[0].cells[0], 'rowspan cell occupies the row below');
        assert.equal(grid[1][1], table.rows[0].cells[0], 'colspan cell occupies the column to the right');
        assert.deepEqual(startOf.get(table.rows[0].cells[0]), { row: 0, col: 0 });
    });

    group('table: rows and columns');

    check('inserts a row above and below', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2 }));
        const anchor = table.rows[1].cells[0];
        const above = tableModule.insertRow(table, anchor, true);
        assert.equal(above.cells.length, 2);
        assert.equal(table.rows.length, 3);
        const below = tableModule.insertRow(table, table.rows[2].cells[0], false);
        assert.equal(below.cells.length, 2);
        assert.equal(table.rows.length, 4);
    });

    check('inserting a row respects vertical merges', () => {
        const table = mount('<table><tbody><tr><td rowspan="2">A</td><td>B</td></tr>'
            + '<tr><td>C</td></tr></tbody></table>');
        const { grid, startOf } = tableModule.tableGrid(table);
        assert.equal(startOf.get(grid[1][0]).row, 0, 'precondition: A covers row 1');
        const row = tableModule.insertRow(table, table.rows[1].cells[0], true);
        assert.equal(row.cells.length, 1, 'merged column gets no extra cell');
        const shape = tableModule.tableGrid(table);
        assert.equal(shape.grid[1][0], table.rows[0].cells[0], 'A extends over the inserted row');
        assert.equal(shape.grid[1][1], row.cells[0], 'unmerged column gets a fresh cell');
    });

    check('inserts columns left and right', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2 }));
        tableModule.insertColumn(table, table.rows[0].cells[1], true);
        assert.equal(table.rows[0].cells.length, 3);
        assert.equal(table.rows[1].cells.length, 3);
        tableModule.insertColumn(table, table.rows[0].cells[2], false);
        assert.equal(table.rows[0].cells.length, 4);
    });

    check('deletes a row and the table when it was the last one', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 2 }));
        assert.ok(tableModule.deleteRow(table, table.rows[0].cells[0]));
        assert.equal(table.rows.length, 2);
        assert.ok(tableModule.deleteRow(table, table.rows[0].cells[0]));
        assert.ok(tableModule.deleteRow(table, table.rows[0].cells[0]));
        assert.equal(table.parentNode, null, 'table removed with its last row');
    });

    check('deleting a column shrinks spans that covered it', () => {
        const table = mount('<table><tbody><tr><td colspan="2">A</td><td>B</td></tr>'
            + '<tr><td>C</td><td>D</td><td>E</td></tr></tbody></table>');
        const { grid } = tableModule.tableGrid(table);
        assert.equal(grid[0][0], table.rows[0].cells[0]);
        assert.equal(grid[0][1], table.rows[0].cells[0], 'precondition: A spans columns 0-1');
        // Delete the second column by targeting a cell whose position is col 1.
        assert.ok(tableModule.deleteColumn(table, table.rows[1].cells[1]));
        const a = table.rows[0].cells[0];
        assert.equal(a.getAttribute('colspan'), null, 'A collapses to a single column');
        assert.equal(a.textContent, 'A');
        assert.equal(table.rows[0].cells.length, 2);
        assert.equal(table.rows[1].cells.length, 2);
    });

    group('table: merge and split');

    check('merges a 2x2 rectangle into one cell with content preserved', () => {
        const table = mount('<table><tbody><tr><td>a</td><td>b</td></tr>'
            + '<tr><td>c</td><td>d</td></tr></tbody></table>');
        const a = table.rows[0].cells[0];
        const d = table.rows[1].cells[1];
        const merged = tableModule.mergeCells(table, a, d);
        assert.ok(merged, 'merge failed');
        assert.equal(merged.textContent, 'abcd');
        assert.equal(merged.getAttribute('rowspan'), '2');
        assert.equal(merged.getAttribute('colspan'), '2');
        assert.equal(cellCount(table), 1);
    });

    check('merging a single column keeps the other column intact', () => {
        const table = mount('<table><tbody><tr><td>a</td><td>b</td></tr>'
            + '<tr><td>c</td><td>d</td></tr></tbody></table>');
        const a = table.rows[0].cells[0];
        const c = table.rows[1].cells[0];
        const merged = tableModule.mergeCells(table, a, c);
        assert.equal(merged.getAttribute('rowspan'), '2');
        assert.equal(merged.getAttribute('colspan'), null);
        assert.equal(cellCount(table), 3);
    });

    check('split returns a merged cell to individual cells', () => {
        const table = mount('<table><tbody><tr><td rowspan="2" colspan="2">big</td></tr>'
            + '<tr></tr></tbody></table>');
        const cell = table.rows[0].cells[0];
        assert.ok(tableModule.splitCell(table, cell));
        assert.equal(table.rows.length, 2);
        assert.equal(table.rows[0].cells.length, 2);
        assert.equal(table.rows[1].cells.length, 2);
        assert.equal(table.rows[0].cells[0].textContent, 'big');
    });

    check('split reports false for an unmerged cell', () => {
        const table = mount('<table><tbody><tr><td>x</td></tr></tbody></table>');
        assert.equal(tableModule.splitCell(table, table.rows[0].cells[0]), false);
    });

    group('table: headers, colour, width, borders');

    check('header row toggle wraps and unwraps the first row', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 2 }));
        tableModule.setHeaderRow(table, true);
        assert.ok(table.tHead);
        assert.equal(table.rows[0].cells[0].tagName, 'TH');
        tableModule.setHeaderRow(table, false);
        assert.equal(table.tHead, null);
        assert.equal(table.rows[0].cells[0].tagName, 'TD');
    });

    check('header column toggle converts the first cell of body rows', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 2 }));
        tableModule.setHeaderColumn(table, true);
        assert.equal(table.rows[1].cells[0].tagName, 'TH');
        assert.equal(table.rows[1].cells[0].getAttribute('scope'), 'row');
        tableModule.setHeaderColumn(table, false);
        assert.equal(table.rows[1].cells[0].tagName, 'TD');
    });

    check('cell shading and alignment write inline styles', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2 }));
        const cells = [...table.rows[0].cells];
        tableModule.setCellShading(cells, '#ffee88');
        assert.ok(/background-color/.test(cells[0].getAttribute('style') || ''), 'shading missing');
        tableModule.setCellShading(cells, null);
        assert.ok(!/background-color/.test(cells[0].getAttribute('style') || ''), 'shading not cleared');
        tableModule.alignCells(cells, 'center');
        assert.ok(/text-align:\s*center/.test(cells[1].getAttribute('style') || ''), 'alignment missing');
    });

    check('width and borders properties round-trip', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2 }));
        tableModule.setTableWidth(table, 'full');
        assert.equal(table.style.getPropertyValue('width'), '100%');
        tableModule.setTableWidth(table, 'auto');
        assert.equal(table.style.getPropertyValue('width'), '');
        assert.ok(tableModule.tableBordersOn(table));
        tableModule.toggleBorders(table);
        assert.equal(tableModule.tableBordersOn(table), false);
        tableModule.toggleBorders(table);
        assert.ok(tableModule.tableBordersOn(table));
    });

    check('caption can be added, edited and removed', () => {
        const table = mount(tableModule.createTableHtml({ rows: 1, cols: 1 }));
        tableModule.setCaption(table, 'Numbers');
        assert.equal(table.querySelector(':scope > caption')?.textContent, 'Numbers');
        tableModule.setCaption(table, '');
        assert.equal(table.querySelector(':scope > caption'), null);
    });

    check('moving a row swaps its position', () => {
        const table = mount(tableModule.createTableHtml({ rows: 3, cols: 1 }));
        table.rows[0].cells[0].textContent = 'one';
        table.rows[1].cells[0].textContent = 'two';
        table.rows[2].cells[0].textContent = 'three';
        assert.ok(tableModule.moveRow(table, table.rows[1].cells[0], -1));
        assert.equal(table.rows[0].cells[0].textContent, 'two');
        assert.equal(table.rows[1].cells[0].textContent, 'one');
        assert.equal(tableModule.moveRow(table, table.rows[0].cells[0], -1), false, 'cannot move above the first row');
    });

    group('table: navigation and normalisation');

    check('stepCell walks in document order and wraps nowhere', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2 }));
        const first = table.rows[0].cells[0];
        const second = tableModule.stepCell(table, first, false);
        assert.equal(second, table.rows[0].cells[1]);
        const last = table.rows[1].cells[1];
        assert.equal(tableModule.stepCell(table, last, false), null);
        assert.equal(tableModule.stepCell(table, last, true), table.rows[1].cells[0]);
    });

    check('normaliseTables lifts nested tables out of cells and fixes empty cells', () => {
        const editor = document.getElementById('editor');
        editor.innerHTML = '<table><tbody><tr><td>a<table><tbody><tr><td>inner</td></tr></tbody></table></td>'
            + '<td></td></tr></tbody></table>';
        tableModule.normaliseTables(editor);
        const [outer, inner] = editor.querySelectorAll('table');
        assert.equal(outer.contains(inner), false, 'inner table still nested inside the outer one');
        assert.equal(inner.parentNode, editor, 'inner table not lifted to a sibling');
        assert.equal(outer.rows[0].cells[0].textContent.trim(), 'a', 'cell prose lost');
        assert.ok(outer.rows[0].cells[1].querySelector('br'), 'empty cell given a caret');
        assert.equal(inner.rows[0].cells[0].textContent, 'inner');
    });

    check('setHeaderRow keeps the caption first', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2, caption: 'Data' }));
        tableModule.setHeaderRow(table, true);
        assert.equal(table.children[0].tagName, 'CAPTION', 'caption displaced by thead');
        assert.equal(table.children[1].tagName, 'THEAD');
    });

    check('selectionRectCells returns the rectangle between anchor and focus', () => {
        const table = mount(tableModule.createTableHtml({ rows: 2, cols: 2 }));
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(table.rows[0].cells[0], 0);
        range.setEnd(table.rows[1].cells[1], 0);
        selection.removeAllRanges();
        selection.addRange(range);
        const cells = tableModule.selectionRectCells(document.getElementById('editor'));
        assert.equal(cells.length, 4);
    });
}
