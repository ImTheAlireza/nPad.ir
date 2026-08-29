/**
 * Shared UI primitives: menus, dialogs and toasts.
 *
 * Replaces the previous hover-only CSS dropdowns (unusable on touch), the
 * hand-rolled modal that cloned nodes and hijacked window.onclick, and the
 * native alert()/prompt() calls.
 */

/* -------------------------------------------------------------------------
   Menus (with flyout submenus)
   ------------------------------------------------------------------------- */

let openMenu = null;

/** Pointer devices only: hover-switching submenus, like native apps. */
const hoverCapable = window.matchMedia
    ? window.matchMedia('(hover: hover) and (pointer: fine)')
    : null;

const isRtl = () => (document.documentElement.getAttribute('dir') || 'ltr').toLowerCase() === 'rtl';

function closeSub(menu, focusTrigger = false) {
    if (!menu.sub) return;
    const { panel, trigger } = menu.sub;
    panel.dataset.open = 'false';
    trigger.setAttribute('aria-expanded', 'false');
    menu.sub = null;
    if (focusTrigger) trigger.focus();
}

function openSub(menu, trigger, focusFirst = false) {
    const panel = document.getElementById(trigger.getAttribute('aria-controls') || '');
    if (!panel) return;
    if (menu.sub && menu.sub.trigger !== trigger) closeSub(menu);
    menu.sub = { panel, trigger };
    panel.dataset.open = 'true';
    trigger.setAttribute('aria-expanded', 'true');
    if (focusFirst) focusItem(panel, 0);
}

function closeMenu(menu) {
    if (!menu) return;
    closeSub(menu);
    menu.panel.dataset.open = 'false';
    menu.trigger.setAttribute('aria-expanded', 'false');
    if (openMenu === menu) openMenu = null;
}

function openMenuPanel(menu) {
    if (openMenu && openMenu !== menu) closeMenu(openMenu);
    menu.panel.dataset.open = 'true';
    menu.trigger.setAttribute('aria-expanded', 'true');
    openMenu = menu;
}

/** Focusable items belonging to one panel — nested flyout items are not
 *  part of their parent panel's keyboard flow. */
function itemsOf(panel) {
    return Array.from(panel.querySelectorAll('.menu__item')).filter(
        (el) => !el.hasAttribute('disabled') && el.closest('.menu__panel') === panel,
    );
}

function focusItem(panel, index) {
    const items = itemsOf(panel);
    if (!items.length) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped].focus();
}

/**
 * Wire up every .menu in the document.
 * Supports click, Enter/Space, Arrow keys (RTL-aware for submenus), Home/End,
 * Escape (flyout first, then the menu) and outside-click.
 */
export function initMenus(root = document) {
    const menus = Array.from(root.querySelectorAll('.menu')).map((el) => ({
        root: el,
        trigger: el.querySelector(':scope > .menu__trigger'),
        panel: el.querySelector(':scope > .menu__panel'),
        sub: null,
    })).filter((m) => m.trigger && m.panel);

    menus.forEach((menu) => {
        menu.trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const isOpen = menu.panel.dataset.open === 'true';
            if (isOpen) closeMenu(menu);
            else openMenuPanel(menu);
        });

        menu.trigger.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openMenuPanel(menu);
                focusItem(menu.panel, 0);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                openMenuPanel(menu);
                focusItem(menu.panel, -1);
            }
        });

        // One keydown handler per panel (root and flyout). The innermost
        // panel handles the event: `closest('.menu__panel') === panel`
        // filters the copies bubbling out of a nested flyout.
        for (const panel of menu.root.querySelectorAll('.menu__panel')) {
            panel.addEventListener('keydown', (event) => {
                const origin = event.target?.closest ? event.target : null;
                if (!origin || origin.closest('.menu__panel') !== panel) return;

                const items = itemsOf(panel);
                const current = items.indexOf(document.activeElement);
                const openKey = isRtl() ? 'ArrowLeft' : 'ArrowRight';
                const closeKey = isRtl() ? 'ArrowRight' : 'ArrowLeft';

                switch (event.key) {
                    case 'ArrowDown':
                        event.preventDefault();
                        focusItem(panel, current + 1);
                        break;
                    case 'ArrowUp':
                        event.preventDefault();
                        focusItem(panel, current - 1);
                        break;
                    case 'Home':
                        event.preventDefault();
                        focusItem(panel, 0);
                        break;
                    case 'End':
                        event.preventDefault();
                        focusItem(panel, -1);
                        break;
                    case openKey: {
                        const trigger = origin.closest('[data-submenu-trigger]');
                        if (trigger) {
                            event.preventDefault();
                            openSub(menu, trigger, true);
                        }
                        break;
                    }
                    case closeKey:
                        if (panel.classList.contains('menu__panel--submenu')) {
                            event.preventDefault();
                            const parent = document.getElementById(panel.getAttribute('aria-labelledby') || '');
                            closeSub(menu);
                            parent?.focus();
                        }
                        break;
                    case 'Escape':
                        event.preventDefault();
                        event.stopPropagation();
                        if (menu.sub) {
                            const { trigger } = menu.sub;
                            closeSub(menu);
                            trigger.focus();
                        } else {
                            closeMenu(menu);
                            menu.trigger.focus();
                        }
                        break;
                    case 'Tab':
                        closeMenu(menu);
                        break;
                    default:
                        break;
                }
            });
        }

        // Flyout triggers: click toggles (touch-friendly — never hover-only),
        // hover opens on pointer devices while the menu is open.
        for (const trigger of menu.root.querySelectorAll('[data-submenu-trigger]')) {
            trigger.addEventListener('click', (event) => {
                // Not an action item: keep the menu open and stop the
                // panel's item-click closer below from dismissing everything.
                event.stopPropagation();
                if (menu.sub && menu.sub.trigger === trigger) closeSub(menu, true);
                else openSub(menu, trigger, true);
            });
            trigger.addEventListener('mouseenter', () => {
                if (hoverCapable && hoverCapable.matches && menu.panel.dataset.open === 'true') {
                    openSub(menu, trigger);
                }
            });
        }

        // Hovering another item of the parent menu closes an open flyout.
        menu.panel.addEventListener('mouseover', (event) => {
            if (!menu.sub || !(hoverCapable && hoverCapable.matches)) return;
            const target = event.target?.closest ? event.target : null;
            if (!target || menu.sub.panel.contains(target) || menu.sub.trigger.contains(target)) return;
            if (target.closest('.menu__panel') !== menu.panel) return;
            if (target.closest('.menu__item')) closeSub(menu);
        });

        // Selecting an item always dismisses the whole menu.
        menu.panel.addEventListener('click', (event) => {
            const item = event.target?.closest ? event.target.closest('.menu__item') : null;
            if (item && !item.hasAttribute('data-submenu-trigger')) closeMenu(menu);
        });
    });

    // One document-level listener, rather than reassigning window.onclick.
    document.addEventListener('click', (event) => {
        if (openMenu && !openMenu.root.contains(event.target)) closeMenu(openMenu);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !openMenu) return;
        // Panels handle their own Escape (flyout first); this covers the
        // case where focus sits outside the panels.
        if (openMenu.sub) {
            const { trigger } = openMenu.sub;
            closeSub(openMenu);
            trigger.focus();
            return;
        }
        const { trigger } = openMenu;
        closeMenu(openMenu);
        trigger.focus();
    });
}

/* -------------------------------------------------------------------------
   Dialogs
   Native <dialog>.showModal() gives focus trapping, Escape handling and
   background inertness without hand-written code.
   ------------------------------------------------------------------------- */

const dialogEl = () => document.getElementById('appDialog');

function renderFooter(buttons) {
    return buttons
        .map(
            (btn) =>
                `<button type="button" class="btn ${btn.variant}" data-action="${btn.action}">${btn.label}</button>`,
        )
        .join('');
}

/**
 * Show a modal dialog.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.bodyHtml]  Trusted markup (built from translations)
 * @param {Array}  [options.buttons]   [{ label, action, variant }]
 * @param {Function} [options.onOpen]  Called with the body element
 * @returns {Promise<string|null>} the chosen action, or null if dismissed
 */
export function showDialog({ title, bodyHtml = '', buttons = [], onOpen } = {}) {
    const dialog = dialogEl();
    if (!dialog) return Promise.resolve(null);

    const titleEl = dialog.querySelector('.dialog__title');
    const bodyEl = dialog.querySelector('.dialog__body');
    const footerEl = dialog.querySelector('.dialog__footer');

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML = renderFooter(buttons);

    if (typeof onOpen === 'function') onOpen(bodyEl);

    return new Promise((resolve) => {
        let settled = false;

        const finish = (value) => {
            if (settled) return;
            settled = true;
            dialog.removeEventListener('close', onClose);
            footerEl.removeEventListener('click', onFooterClick);
            closeBtn.removeEventListener('click', onCloseClick);
            bodyEl.removeEventListener('keydown', onBodyKeydown);
            if (dialog.open) dialog.close();
            resolve(value);
        };

        const onFooterClick = (event) => {
            const btn = event.target.closest('[data-action]');
            if (btn) finish(btn.dataset.action);
        };

        // Escape and backdrop dismissal both fire 'close'.
        const onClose = () => finish(null);
        const onCloseClick = () => finish(null);

        // Enter in a text field submits the primary action.
        const onBodyKeydown = (event) => {
            if (event.key === 'Enter' && event.target.matches('input')) {
                event.preventDefault();
                const primary = footerEl.querySelector('.btn--primary[data-action]');
                if (primary) finish(primary.dataset.action);
            }
        };

        const closeBtn = dialog.querySelector('.dialog__close');

        footerEl.addEventListener('click', onFooterClick);
        closeBtn.addEventListener('click', onCloseClick);
        dialog.addEventListener('close', onClose);
        bodyEl.addEventListener('keydown', onBodyKeydown);

        dialog.showModal();

        const autofocus = bodyEl.querySelector('[autofocus], input, select');
        if (autofocus) autofocus.focus();
        else {
            const primary = footerEl.querySelector('.btn--primary');
            if (primary) primary.focus();
        }
    });
}

/**
 * Confirmation dialog.
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
    const bodyHtml = `<p>${escapeHtml(message)}</p>`;
    const action = await showDialog({
        title,
        bodyHtml,
        buttons: [
            { label: cancelLabel, action: 'cancel', variant: 'btn--ghost' },
            { label: confirmLabel, action: 'confirm', variant: danger ? 'btn--danger' : 'btn--primary' },
        ],
    });
    return action === 'confirm';
}

/* -------------------------------------------------------------------------
   Toasts
   ------------------------------------------------------------------------- */

/**
 * Announce a transient message. The region is aria-live, so screen readers
 * hear it without focus moving.
 *
 * @param {string} message
 * @param {'info'|'success'|'error'} [variant]
 */
export function toast(message, variant = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast--${variant}`;
    el.textContent = message;

    // Native <dialog> with showModal() paints its ::backdrop in the CSS top
    // layer, which sits above every z-index in the normal stacking context.
    // Appending the toast to the open dialog keeps it in the same top-layer
    // context so it's always visible above the backdrop.
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) {
        el.classList.add('toast--in-dialog');
        openDialog.appendChild(el);
    } else {
        const region = document.getElementById('toastRegion');
        if (!region) return;
        region.appendChild(el);
    }

    window.setTimeout(() => {
        el.classList.add('toast--leaving');
        window.setTimeout(() => el.remove(), 200);
    }, 4200);
}

/** Escape text for interpolation into dialog markup. */
export function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}
