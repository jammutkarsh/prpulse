// The dashboard page, as each surface loads it. The query string is how the page knows where it is.
// Kept free of imports: the manifest generator reads these in node, where the browser API does not load.

export const POPUP_PATH = 'popup/popup.html';
export const SIDEBAR_PATH = 'popup/popup.html?sidebar=1';
export const SETTINGS_PATH = 'settings/settings.html';
// Settings opened inside the sidebar itself; the query tells it where Back leads.
export const SIDEBAR_SETTINGS_PATH = 'settings/settings.html?sidebar=1';

/**
 * Chrome's shortcut for opening or closing the dashboard. Not `_execute_action`: the browser consumes a
 * registered shortcut, so while the popup is open nothing reaches it to close it. A custom command
 * always reaches the worker, which can then do the closing itself. Firefox keeps `_execute_action`.
 */
export const TOGGLE_COMMAND = 'toggle-dashboard';
