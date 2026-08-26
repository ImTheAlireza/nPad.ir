/**
 * NPad table engine.
 *
 * The editor uses native contenteditable, so tables cannot rely on
 * document.execCommand (no browser implements table commands) and must be
 * driven directly against the DOM. This module computes a logical grid of a
 * table (resolving rowspans and colspans), then implements every structural
 * operation in terms of that grid so merged cells never desynchronise.
 *
 * Everything here is local and dependency-free. `normaliseTables` is applied
 * after paste/import so content pasted from Excel, Word or the web arrives in
 * the single-level shape the grid model expects (nested tables are lifted
 * out as siblings and empty cells get a <br> so the caret can live there).
 */

export const MAX_ROWS = 50;
export const MAX_COLS = 20;

/** Rowspans/colspans are bounded (sanitizer caps at 100 too). */
const MAX_SPAN = 100;

const CELL_TAGS = new Set(['TD', 'TH']);

function isCellElement(node) {
    return node?.nodeType === 1 && CELL_TAGS.has(node.tagName);
}

function spanOf(cell, name, fallback) {
    const value = Number.parseInt(cell.getAttribute(name) || '', 10);
    return Number.isInteger(value) && value >= 1 && value <= MAX_SPAN ? value : fallback;
}

function setSpan(cell, name, value) {
    if (value > 1) cell.setAttribute(name, String(value));
    else cell.removeAttribute(name);
}

/** All rows belonging to this table (never to a nested one). */
function tableRows(table) {
    return [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table);
}

function rowCells(row) {
    return [...row.children].filter(isCellElement);
}

/**
 * Logical grid: grid[row][col] is the cell element occupying that position
 * (a merged cell appears at every position it spans). `startOf` maps a cell
 * to its top-left { row, col }.
 */
export function tableGrid(table) {
    const rows = tableRows(table);
    const grid = [];
    const startOf = new Map();
    // vertical[row] = Map(column -> cell) for cells whose rowspan reaches this
    // row from above. The cell is recorded, not just the column, so grid
    // lookups return the occupying cell (that is what makes merge/delete math
    // correct for spans).
    const vertical = [];
    let colCount = 0;

    rows.forEach((row, rowIndex) => {
        const line = [];
        let col = 0;

        // Materialise cells whose rowspan reaches this row from above, even
        // when the row itself has no cells.
        if (vertical[rowIndex]) {
            for (const [occupiedCol, occupant] of vertical[rowIndex]) line[occupiedCol] = occupant;
        }

        for (const cell of rowCells(row)) {
            const rowspan = spanOf(cell, 'rowspan', 1);
            const colspan = spanOf(cell, 'colspan', 1);

            // Skip positions already occupied by a rowspan cell from an
            // earlier row (that is how the HTML table model works).
            while (col < MAX_COLS * 2 && line[col]) col += 1;

            startOf.set(cell, { row: rowIndex, col });
            for (let c = 0; c < colspan; c += 1) {
                if (line[col + c] && line[col + c] !== cell) break; // malformed overlap: keep first
                line[col + c] = cell;
            }
            for (let r = 1; r < rowspan; r += 1) {
                const map = vertical[rowIndex + r] || (vertical[rowIndex + r] = new Map());
                for (let c = 0; c < colspan; c += 1) map.set(col + c, cell);
            }
            col += colspan;
        }
        grid.push(line);
        if (col > colCount) colCount = col;
    });

    return { rows, grid, colCount, rowCount: rows.length, startOf };
}

/** Logical position ({ row, col }) of a cell, or null if it is not in the table. */
export function cellPosition(table, cell) {
    if (!isCellElement(cell)) return null;
    const { startOf } = tableGrid(table);
    return startOf.get(cell) || null;
}

/** The cell occupying grid position (row, col), or null. */
export function cellAt(table, row, col) {
    const { grid } = tableGrid(table);
    return grid[row]?.[col] || null;
}

/** Nearest table cell (td/th) containing a node, or null. */
export function closestTableCell(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const cell = element?.closest?.('td, th');
    return isCellElement(cell) ? cell : null;
}

/** Nearest table containing a node, or null. */
export function closestTable(node) {
    return closestTableCell(node)?.closest('table') || null;
}

function makeCell(tag = 'td') {
    const cell = document.createElement(tag);
    cell.appendChild(document.createElement('br'));
    return cell;
}

/**
 * Serialise a table as HTML. Header row becomes <thead><th scope="col">,
 * header column becomes <th scope="row"> on the first cell of each body row.
 */
export function tableCellHtml(text = '') {
    return text ? text : '<br>';
}

export function createTableHtml({ rows = 3, cols = 3, headerRow = false, headerColumn = false, width = 'auto', caption = '' } = {}) {
    const rowCount = Math.min(MAX_ROWS, Math.max(1, Math.round(rows) || 1));
    const colCount = Math.min(MAX_COLS, Math.max(1, Math.round(cols) || 1));
    const style = width === 'full' ? ' style="width:100%"' : '';

    const renderRow = (index, isHeader) => {
        const cells = [];
        for (let c = 0; c < colCount; c += 1) {
            const isColHeader = headerColumn && index > 0 && c === 0;
            const isRowHeaderCell = isHeader || isColHeader;
            const tag = isRowHeaderCell ? 'th' : 'td';
            const scope = isHeader ? ' scope="col"' : isColHeader ? ' scope="row"' : '';
            cells.push(`<${tag}${scope}>${tableCellHtml()}</${tag}>`);
        }
        return `<tr>${cells.join('')}</tr>`;
    };

    const rowsHtml = [];
    for (let i = 0; i < rowCount; i += 1) {
        const isHeader = headerRow && i === 0;
        rowsHtml.push(renderRow(i, isHeader));
    }

    let body = '';
    if (headerRow) {
        body = `<thead>${rowsHtml.shift()}</thead><tbody>${rowsHtml.join('')}</tbody>`;
    } else {
        body = `<tbody>${rowsHtml.join('')}</tbody>`;
    }
    const captionHtml = caption ? `<caption>${caption}</caption>` : '';
    return `<table${style}>${captionHtml}${body}</table>`;
}

/**
 * Make pasted/imported content safe for the grid model:
 *  - nested tables are lifted out as siblings (they break row/col math)
 *  - every table row has at least one cell
 *  - empty cells contain a <br> so the caret can be placed there
 */
export function normaliseTables(root) {
    root.querySelectorAll('table').forEach((table) => {
        // Lifting nested tables: `closest('table')` matches the nested table
        // itself, so the owning cell (its td/th ancestor) must be checked
        // against the current table instead.
        for (const nested of [...table.querySelectorAll('td table, th table')]) {
            const cell = nested.closest('td, th');
            if (!cell || cell.closest('table') !== table) continue;
            nested.remove();
            table.parentNode?.insertBefore(nested, table.nextSibling);
            if (!cell.textContent && !cell.querySelector('br, img')) {
                cell.appendChild(makeCell().firstChild);
            }
        }
        tableRows(table).forEach((row) => {
            if (!rowCells(row).length) row.appendChild(makeCell());
        });
        table.querySelectorAll('td, th').forEach((cell) => {
            if (!cell.textContent && !cell.querySelector('br, img')) cell.appendChild(makeCell().firstChild);
        });
    });
}

/* -------------------------------------------------------------------------
   Structural operations (all grid-accurate)
   ------------------------------------------------------------------------- */

/** Columns of row `target` that are already occupied by a rowspan from above. */
function coveredColumns(gridData, target) {
    const covered = new Set();
    for (let r = 0; r < target; r += 1) {
        for (const cell of gridData.rows[r] ? rowCells(gridData.rows[r]) : []) {
            const pos = gridData.startOf.get(cell);
            const end = pos.row + spanOf(cell, 'rowspan', 1) - 1;
            if (pos.row < target && end >= target) {
                for (let c = pos.col; c < pos.col + spanOf(cell, 'colspan', 1); c += 1) covered.add(c);
            }
        }
    }
    return covered;
}

/** Rows where column `target` is already covered by a colspan from the left. */
function coveredRows(gridData, target) {
    const covered = new Set();
    gridData.rows.forEach((row, r) => {
        for (const cell of rowCells(row)) {
            const pos = gridData.startOf.get(cell);
            const end = pos.col + spanOf(cell, 'colspan', 1) - 1;
            if (pos.col < target && end >= target) covered.add(r);
        }
    });
    return covered;
}

/** Insert a row above or below the row containing `refCell`. Returns the row. */
export function insertRow(table, refCell, before = true) {
    const gridData = tableGrid(table);
    const pos = gridData.startOf.get(refCell);
    if (!pos) return null;
    const target = before ? pos.row : pos.row + 1;
    return insertRowAt(table, gridData, target);
}

export function insertRowAt(table, gridData, target) {
    const row = document.createElement('tr');
    const covered = coveredColumns(gridData, target);
    for (let c = 0; c < gridData.colCount; c += 1) {
        if (covered.has(c)) continue;
        row.appendChild(makeCell());
    }
    if (!rowCells(row).length) row.appendChild(makeCell());

    const anchor = gridData.rows[target] || null;
    if (anchor) {
        anchor.parentNode.insertBefore(row, anchor);
        return row;
    }
    // Appending past the last row: data rows belong in <tbody>, never in a
    // <thead> (a header-only table appends its first body row here).
    const last = gridData.rows[gridData.rows.length - 1];
    let parent = last ? last.parentNode : null;
    if (parent?.tagName === 'THEAD') {
        parent = table.querySelector(':scope > tbody')
            || (() => {
                const tbody = document.createElement('tbody');
                table.appendChild(tbody);
                return tbody;
            })();
    }
    (parent || table).appendChild(row);
    return row;
}

/** Insert a column left or right of the column containing `refCell`. */
export function insertColumn(table, refCell, before = true) {
    const gridData = tableGrid(table);
    const pos = gridData.startOf.get(refCell);
    if (!pos) return null;
    const target = before ? pos.col : pos.col + 1;
    return insertColumnAt(table, gridData, target);
}

export function insertColumnAt(table, gridData, target) {
    const skipped = coveredRows(gridData, target);
    gridData.rows.forEach((row, r) => {
        if (skipped.has(r)) return;
        const cell = makeCell();
        // Insert before the first cell that starts at or after the target column.
        let anchor = null;
        for (const existing of rowCells(row)) {
            const pos = gridData.startOf.get(existing);
            if (pos && pos.col >= target) {
                anchor = existing;
                break;
            }
        }
        row.insertBefore(cell, anchor || null);
    });
}

export function deleteRow(table, refCell) {
    const gridData = tableGrid(table);
    const pos = gridData.startOf.get(refCell);
    if (!pos) return false;
    const r = pos.row;
    const { rows } = gridData;
    const row = rows[r];

    // Cells whose own rowspan reaches past the deleted row move down one row
    // (they keep covering the rows below), with their span reduced by one.
    for (const cell of rowCells(row)) {
        const rowspan = spanOf(cell, 'rowspan', 1);
        if (rowspan > 1) {
            const below = rows[r + 1];
            if (below) {
                const col = gridData.startOf.get(cell).col;
                let anchor = null;
                for (const existing of rowCells(below)) {
                    const p = gridData.startOf.get(existing);
                    if (p && p.col >= col) { anchor = existing; break; }
                }
                below.insertBefore(cell, anchor || null);
                setSpan(cell, 'rowspan', rowspan - 1);
            }
        }
    }

    // Cells above whose rowspan covered the deleted row shrink by one.
    for (let rr = 0; rr < r; rr += 1) {
        for (const cell of rowCells(rows[rr])) {
            const p = gridData.startOf.get(cell);
            const end = p.row + spanOf(cell, 'rowspan', 1) - 1;
            if (end >= r) setSpan(cell, 'rowspan', spanOf(cell, 'rowspan', 1) - 1);
        }
    }

    row.remove();
    const section = row.parentNode;
    if (section && section.tagName === 'THEAD' && !tableRows(table).some((rowEl) => rowEl.closest('thead') === section)) {
        section.remove();
    }
    if (!tableRows(table).length) table.remove();
    return true;
}

export function deleteColumn(table, refCell) {
    const gridData = tableGrid(table);
    const pos = gridData.startOf.get(refCell);
    if (!pos) return false;
    const target = pos.col;
    const handled = new Set();

    gridData.rows.forEach((row, r) => {
        const cell = gridData.grid[r]?.[target];
        if (!cell || handled.has(cell)) return;
        handled.add(cell);

        const spanPos = gridData.startOf.get(cell);
        const colspan = spanOf(cell, 'colspan', 1);
        if (colspan > 1) {
            // The deleted column is inside its span (or is its first column):
            // the cell simply covers one column less.
            setSpan(cell, 'colspan', colspan - 1);
        } else if (spanPos.col === target && colspan === 1) {
            cell.remove();
        }
    });

    if (!tableRows(table).some((row) => rowCells(row).length)) table.remove();
    return true;
}

export function deleteTable(table) {
    table.remove();
    return true;
}

/* -------------------------------------------------------------------------
   Merging and splitting
   ------------------------------------------------------------------------- */

/**
 * Merge the cells inside the rectangle between two cells. Returns the merged
 * cell, or null when there is nothing to merge.
 */
export function mergeCells(table, cellA, cellB) {
    const gridData = tableGrid(table);
    const a = gridData.startOf.get(cellA);
    const b = gridData.startOf.get(cellB);
    if (!a || !b) return null;
    if (a.row === b.row && a.col === b.col) return null;

    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);

    const topLeft = gridData.rows[r1];
    if (!topLeft) return null;

    // Find the cell occupying the top-left corner of the rectangle.
    let anchor = null;
    for (const cell of rowCells(topLeft)) {
        const p = gridData.startOf.get(cell);
        if (p && p.col <= c1 && p.col + spanOf(cell, 'colspan', 1) - 1 >= c1
            && p.row <= r1 && p.row + spanOf(cell, 'rowspan', 1) - 1 >= r1) {
            anchor = cell;
            break;
        }
    }
    if (!anchor) return null;

    const collected = [];
    for (let r = r1; r <= r2; r += 1) {
        const rowEl = gridData.rows[r];
        if (!rowEl) continue;
        for (const cell of rowCells(rowEl)) {
            const p = gridData.startOf.get(cell);
            if (!p) continue;
            const overlaps = p.row <= r2 && p.row + spanOf(cell, 'rowspan', 1) - 1 >= r1
                && p.col <= c2 && p.col + spanOf(cell, 'colspan', 1) - 1 >= c1;
            if (overlaps && cell !== anchor) { collected.push(cell); cell.remove(); }
        }
    }

    setSpan(anchor, 'rowspan', r2 - r1 + 1);
    setSpan(anchor, 'colspan', c2 - c1 + 1);

    for (const cell of collected) {
        const br = document.createElement('br');
        anchor.appendChild(br);
        while (cell.firstChild) anchor.appendChild(cell.firstChild);
    }
    if (!anchor.textContent && !anchor.querySelector('br')) anchor.appendChild(document.createElement('br'));
    return anchor;
}

/** Split a merged cell back into individual cells. */
export function splitCell(table, cell) {
    const gridData = tableGrid(table);
    const pos = gridData.startOf.get(cell);
    if (!pos) return false;
    const rowspan = spanOf(cell, 'rowspan', 1);
    const colspan = spanOf(cell, 'colspan', 1);
    if (rowspan === 1 && colspan === 1) return false;

    const r1 = pos.row;
    const r2 = r1 + rowspan - 1;
    const c1 = pos.col;
    const c2 = c1 + colspan - 1;
    const tag = cell.tagName;
    const content = cell.innerHTML;
    cell.remove();
    setSpan(cell, 'rowspan', 1);
    setSpan(cell, 'colspan', 1);

    const regrid = tableGrid(table);
    for (let r = r1; r <= r2; r += 1) {
        const rowEl = regrid.rows[r];
        if (!rowEl) continue;
        for (let c = c1; c <= c2; c += 1) {
            if (r === r1 && c === c1) {
                cell.innerHTML = content;
                if (!cell.textContent && !cell.querySelector('br')) cell.appendChild(document.createElement('br'));
                // Insert the original cell back at its position.
                insertCellIntoRow(rowEl, cell, c, regrid);
                continue;
            }
            const fresh = document.createElement(tag === 'TH' ? 'th' : 'td');
            fresh.appendChild(document.createElement('br'));
            insertCellIntoRow(rowEl, fresh, c, regrid);
        }
    }
    return true;
}

function insertCellIntoRow(row, cell, col, gridData) {
    let anchor = null;
    for (const existing of rowCells(row)) {
        const pos = gridData.startOf.get(existing);
        if (pos && pos.col >= col) { anchor = existing; break; }
    }
    row.insertBefore(cell, anchor || null);
}

/* -------------------------------------------------------------------------
   Headers, alignment, colour, width, borders
   ------------------------------------------------------------------------- */

export function isHeaderRowActive(table) {
    const first = tableRows(table)[0];
    return !!first && first.parentNode?.tagName === 'THEAD';
}

export function isHeaderColumnActive(table, cell) {
    if (!cell) return false;
    const row = cell.parentNode;
    const first = rowCells(row)[0];
    return !!first && first.tagName === 'TH' && first.getAttribute('scope') === 'row';
}

export function setHeaderRow(table, on) {
    const rows = tableRows(table);
    const first = rows[0];
    if (!first) return;

    if (on) {
        if (first.parentNode?.tagName !== 'THEAD') {
            const thead = table.querySelector(':scope > thead') || document.createElement('thead');
            if (!thead.parentNode) {
                // A caption must stay the first child; thead goes after it.
                const caption = table.querySelector(':scope > caption');
                table.insertBefore(thead, caption ? caption.nextSibling : table.firstChild);
            }
            thead.appendChild(first);
        }
        for (const cell of rowCells(first)) {
            cell.outerHTML = cell.outerHTML.replace(/^<td/i, '<th').replace(/^<TH/i, '<th').replace(/>/, ' scope="col">');
        }
    } else {
        const thead = table.querySelector(':scope > thead');
        const tbody = table.querySelector(':scope > tbody') || document.createElement('tbody');
        if (thead) {
            for (const row of [...thead.rows]) {
                for (const cell of rowCells(row)) {
                    const matrix = cell.outerHTML.replace(/^<th/i, '<td').replace(/^<TH/i, '<td');
                    cell.outerHTML = matrix.replace(/ scope="col"/gi, '');
                }
                tbody.insertBefore(row, null);
            }
            if (!tbody.parentNode) table.insertBefore(tbody, table.querySelector(':scope > tfoot') || null);
            if (!thead.rows.length) thead.remove();
        }
    }
}

export function setHeaderColumn(table, on) {
    const gridData = tableGrid(table);
    gridData.rows.forEach((row, r) => {
        // The top-left corner belongs to the header row when that is active.
        if (!row || r === 0) return;
        const first = rowCells(row)[0];
        if (!first) return;
        const pos = gridData.startOf.get(first);
        if (!pos || pos.col !== 0) return;
        if (on) {
            if (first.tagName !== 'TH') {
                first.outerHTML = first.outerHTML.replace(/^<td/i, '<th').replace(/>/, ' scope="row">');
            } else if (!first.getAttribute('scope')) {
                first.setAttribute('scope', 'row');
            }
        } else if (first.tagName === 'TH' && first.getAttribute('scope') === 'row') {
            first.outerHTML = first.outerHTML.replace(/^<th/i, '<td').replace(/ scope="row"/gi, '');
        }
    });
}

export function setCellShading(cells, colour) {
    for (const cell of cells) {
        if (colour) cell.style.setProperty('background-color', colour);
        else cell.style.removeProperty('background-color');
    }
}

export function alignCells(cells, value) {
    for (const cell of cells) {
        if (value) cell.style.setProperty('text-align', value);
        else cell.style.removeProperty('text-align');
    }
}

export function setTableWidth(table, mode) {
    if (mode === 'full') table.style.setProperty('width', '100%');
    else table.style.removeProperty('width');
}

/** Toggle table borders; returns the new state (true = borders visible). */
export function toggleBorders(table) {
    const hide = tableBordersOn(table);
    // border-width is used instead of the `border: none` shorthand: it means
    // the same thing in every browser and round-trips through style parsing.
    for (const cell of table.querySelectorAll('td, th')) {
        if (hide) cell.style.setProperty('border-width', '0');
        else cell.style.removeProperty('border-width');
    }
    return !hide;
}

export function tableBordersOn(table) {
    const first = table.querySelector('td, th');
    if (!first) return true;
    const width = Number.parseFloat(first.style.getPropertyValue('border-width'));
    // No inline width means the stylesheet's default border is in effect.
    return Number.isFinite(width) ? width > 0 : true;
}

export function setCaption(table, text) {
    let caption = table.querySelector(':scope > caption');
    if (!caption && text) {
        caption = document.createElement('caption');
        table.insertBefore(caption, table.firstChild);
    }
    if (caption) {
        if (text) caption.textContent = text;
        else caption.remove();
    }
}

export function moveRow(table, cell, delta) {
    const gridData = tableGrid(table);
    const pos = gridData.startOf.get(cell);
    if (!pos) return false;
    const target = pos.row + delta;
    if (target < 0 || target >= gridData.rows.length) return false;
    const row = gridData.rows[pos.row];
    const other = gridData.rows[target];
    // Crossing a section boundary (thead <-> tbody) silently changes header
    // semantics, so only move within the same section.
    if (row.parentNode?.tagName !== other.parentNode?.tagName) return false;
    if (delta > 0) other.parentNode.insertBefore(row, other.nextSibling);
    else other.parentNode.insertBefore(row, other);
    return true;
}

/* -------------------------------------------------------------------------
   Navigation and caret
   ------------------------------------------------------------------------- */

export function allCells(table) {
    return [...table.querySelectorAll('td, th')].filter((cell) => cell.closest('table') === table);
}

/** Next/previous cell in document order; forward from the last cell yields null. */
export function stepCell(table, cell, backwards = false) {
    const cells = allCells(table);
    const index = cells.indexOf(cell);
    if (index === -1) return null;
    if (backwards) return cells[index - 1] || null;
    return cells[index + 1] || null;
}

export function placeCaretInCell(cell, { atStart = false } = {}) {
    if (!cell) return false;
    const selection = window.getSelection();
    const range = document.createRange();
    selection.removeAllRanges();
    if (atStart) {
        range.setStart(cell, 0);
    } else {
        range.selectNodeContents(cell);
        range.collapse(false);
    }
    selection.addRange(range);
    return true;
}

/**
 * Cells affected by the current selection: the rectangle between the anchor
 * and focus cells. Used for merge, alignment and shading.
 */
export function selectionRectCells(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return [];
    const anchorCell = closestTableCell(selection.anchorNode);
    const focusCell = closestTableCell(selection.focusNode);
    if (!anchorCell || !focusCell) return [];
    const table = anchorCell.closest('table');
    if (!table || focusCell.closest('table') !== table) return [anchorCell];

    const gridData = tableGrid(table);
    const a = gridData.startOf.get(anchorCell);
    const b = gridData.startOf.get(focusCell);
    if (!a || !b) return [anchorCell];

    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);

    const cells = [];
    const seen = new Set();
    for (let r = r1; r <= r2; r += 1) {
        const row = gridData.rows[r];
        if (!row) continue;
        for (const cell of rowCells(row)) {
            const pos = gridData.startOf.get(cell);
            if (!pos || seen.has(cell)) continue;
            const overlaps = pos.row <= r2 && pos.row + spanOf(cell, 'rowspan', 1) - 1 >= r1
                && pos.col <= c2 && pos.col + spanOf(cell, 'colspan', 1) - 1 >= c1;
            if (overlaps) { cells.push(cell); seen.add(cell); }
        }
    }
    return cells.length ? cells : [anchorCell];
}
