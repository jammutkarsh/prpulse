// How big the toolbar popup may be. Pure so the rules can be checked in node; the resize handles
// only feed it pointer positions and the screen's numbers.

import { DEFAULT_SETTINGS } from './ui-config';

export interface PopupSize {
	width: number;
	height: number;
}

/**
 * CSS pixels. The maximums are not a preference: Firefox and Chrome both cap an action popup at
 * 800×600 and clip whatever is drawn past that, so a taller frame would lose its footer.
 */
export const POPUP_LIMITS = { minWidth: 360, minHeight: 320, maxWidth: 800, maxHeight: 600 } as const;

/** The stock width, for a stored size that cannot be read. The config is in rem; 16px is the browser default. */
export const DEFAULT_POPUP_WIDTH = DEFAULT_SETTINGS.ui.popupWidthRem * 16;

/** Gap kept between the popup's bottom edge and the end of the usable screen. */
const SCREEN_MARGIN = 8;

interface ScreenGeometry {
	/** Top of the popup on the screen. */
	screenY: number;
	/** Top of the usable screen area: non-zero under a menu bar. */
	availTop: number;
	availHeight: number;
}

/**
 * Room between the popup's top edge and the bottom of the usable screen. Falls back to the whole
 * usable height when the popup's position cannot be read, which still stops an absurd stored size.
 */
export function availablePopupHeight({ screenY, availTop, availHeight }: ScreenGeometry): number {
	if (!Number.isFinite(availHeight) || availHeight <= 0) return POPUP_LIMITS.maxHeight;

	const offset = Number.isFinite(screenY) && Number.isFinite(availTop) ? Math.max(0, screenY - availTop) : 0;
	return Math.floor(availHeight - offset - SCREEN_MARGIN);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
	return Math.round(Math.min(Math.max(Number.isFinite(value) ? value : fallback, min), Math.max(min, max)));
}

/** The nearest allowed size. The minimum wins over a screen too short to honour it. */
export function clampPopupSize(size: PopupSize, availableHeight: number = POPUP_LIMITS.maxHeight): PopupSize {
	return {
		width: clamp(size.width, POPUP_LIMITS.minWidth, POPUP_LIMITS.maxWidth, DEFAULT_POPUP_WIDTH),
		height: clamp(size.height, POPUP_LIMITS.minHeight, Math.min(POPUP_LIMITS.maxHeight, availableHeight), POPUP_LIMITS.maxHeight),
	};
}

export type ResizeEdge = 'bottom' | 'bottom-left' | 'bottom-right';

/**
 * The size a drag has reached. Pointer movement is in screen coordinates because the popup itself
 * moves and grows under the pointer mid-drag. A left-corner drag widens by moving left.
 */
export function resizedPopupSize(start: PopupSize, edge: ResizeEdge, dx: number, dy: number, availableHeight?: number): PopupSize {
	const widthDelta = edge === 'bottom-right' ? dx : edge === 'bottom-left' ? -dx : 0;
	return clampPopupSize({ width: start.width + widthDelta, height: start.height + dy }, availableHeight);
}
