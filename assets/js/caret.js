/**
 * Caret boundary helpers shared by the code-block and math modules.
 *
 * Deliberately not compareBoundaryPoints(): some engines (jsdom, older
 * webviews) score the equivalent boundary points (code, 0) and (text, 0) as
 * different, which would make a caret look like it is never at an edge.
 */

const childIndexOf = (parent, node) => {
    let index = 0;
    for (let child = parent.firstChild; child; child = child.nextSibling) {
        if (child === node) break;
        index += 1;
    }
    return index;
};

/**
 * True when a collapsed caret sits exactly at one end of `root`'s text:
 * no text nodes exist after (atEnd) / before (!atEnd) the caret point.
 *
 * @param {Selection} selection
 * @param {Element} root
 * @param {boolean} atEnd
 * @returns {boolean}
 */
export function caretAtEdge(selection, root, atEnd) {
    if (!selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    const offset = range.startOffset;

    const walker = document.createTreeWalker(root, 4); // SHOW_TEXT
    let node;
    while ((node = walker.nextNode())) {
        if (node === container) {
            if (atEnd) {
                if (offset < (container.nodeValue || '').length) return false;
            } else if (offset > 0) {
                return false;
            }
            continue;
        }
        const pos = container.compareDocumentPosition(node);
        if (pos & window.Node.DOCUMENT_POSITION_CONTAINED_BY) {
            // node lives inside the caret's container: compare child indexes
            const index = childIndexOf(container, node);
            if (atEnd ? index >= offset : index < offset) return false;
        } else if (atEnd) {
            if (pos & window.Node.DOCUMENT_POSITION_FOLLOWING) return false;
        } else if (pos & window.Node.DOCUMENT_POSITION_PRECEDING) {
            return false;
        }
    }
    return true;
}
