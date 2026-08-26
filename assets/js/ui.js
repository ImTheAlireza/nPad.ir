/**
 * Shared UI primitives: menus, dialogs and toasts.
 *
 * Replaces the previous hover-only CSS dropdowns (unusable on touch), the
 * hand-rolled modal that cloned nodes and hijacked window.onclick, and the
 * native alert()/prompt() calls.
 */

/* -------------------------------------------------------------------------
   Menus
   ------------------------------------------------------------------------- */

let openMenu = null;

function closeMenu(menu) {
    if (!menu) return;
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

function menuItems(menu) {
    return Array.from(menu.panel.querySelectorAll('.menu__item')).filter(
        (el) => !el.hasAttribute('disabled'),
    );
}

function focusItem(menu, index) {
    const items = menuItems(menu);
    if (!items.length) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped].focus();
}

/**
 * Wire up every .menu in the document.
 * Supports click, Enter/Space, Arrow keys, Home/End, Escape and outside-click.
 */
export function initMenus(root = document) {
    const menus = Array.from(root.querySelectorAll('.menu')).map((el) => ({
        root: el,
        trigger: el.querySelector('.menu__trigger'),
        panel: el.querySelector('.menu__panel'),
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
                focusItem(menu, 0);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                openMenuPanel(menu);
                focusItem(menu, -1);
            }
        });

        menu.panel.addEventListener('keydown', (event) => {
            const items = menuItems(menu);
            const current = items.indexOf(document.activeElement);

            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    focusItem(menu, current + 1);
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    focusItem(menu, current - 1);
                    break;
                case 'Home':
                    event.preventDefault();
                    focusItem(menu, 0);
                    break;
                case 'End':
                    event.preventDefault();
                    focusItem(menu, -1);
                    break;
                case 'Escape':
                    event.preventDefault();
                    closeMenu(menu);
                    menu.trigger.focus();
                    break;
                case 'Tab':
                    closeMenu(menu);
                    break;
                default:
                    break;
            }
        });

        // Selecting an item always dismisses the menu.
        menu.panel.addEventListener('click', (event) => {
            if (event.target.closest('.menu__item')) closeMenu(menu);
        });
    });

    // One document-level listener, rather than reassigning window.onclick.
    document.addEventListener('click', (event) => {
        if (openMenu && !openMenu.root.contains(event.target)) closeMenu(openMenu);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openMenu) {
            const trigger = openMenu.trigger;
            closeMenu(openMenu);
            trigger.focus();
        }
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
    const region = document.getElementById('toastRegion');
    if (!region) return;

    const el = document.createElement('div');
    el.className = `toast toast--${variant}`;
    el.textContent = message;
    region.appendChild(el);

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
