/**
 * Entry point for pages that are not the editor (landing pages, the
 * comparison page, privacy). These render the app bar in "chrome only" mode —
 * brand, language switch and the theme toggle — with no File/Edit/Insert
 * menus, so the only interactive control is the theme toggle.
 *
 * The full app bundle (app.js) is deliberately not loaded here: it pulls in
 * the editor, storage, sanitiser and codecs, none of which these pages use.
 * This keeps marketing pages light while still making the one visible control
 * actually work.
 */

import { initTheme } from './theme.js';

initTheme();
