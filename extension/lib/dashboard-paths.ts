// The dashboard page, as each surface loads it. The query string is how the page knows where it is.
// Kept free of imports: the manifest generator reads these in node, where the browser API does not load.

export const POPUP_PATH = 'popup/popup.html';
export const SIDEBAR_PATH = 'popup/popup.html?sidebar=1';
