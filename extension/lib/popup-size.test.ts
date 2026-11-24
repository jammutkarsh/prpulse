import assert from 'node:assert/strict';
import { availablePopupHeight, clampPopupSize, POPUP_LIMITS, resizedPopupSize } from './popup-size';

// The remembered popup size is replayed on every open, on whatever display that happens to be.
// Run with: npm test

function testClamp(): void {
	assert.deepEqual(clampPopupSize({ width: 448, height: 500 }), { width: 448, height: 500 });
	assert.deepEqual(clampPopupSize({ width: 100, height: 100 }), { width: POPUP_LIMITS.minWidth, height: POPUP_LIMITS.minHeight });
	// The browser clips an action popup past these, so they are a ceiling even on a huge display.
	assert.deepEqual(clampPopupSize({ width: 5000, height: 5000 }, 2000), { width: 800, height: 600 });

	// A size saved on a tall display is cut back when the popup opens on a short one.
	assert.deepEqual(clampPopupSize({ width: 448, height: 600 }, 450), { width: 448, height: 450 });
	// ...but never below the minimum, even if the screen says there is less room than that.
	assert.equal(clampPopupSize({ width: 448, height: 600 }, 100).height, POPUP_LIMITS.minHeight);

	// An unreadable size falls back to the stock width, not the narrowest one.
	assert.deepEqual(clampPopupSize({ width: Number.NaN, height: Number.NaN }), { width: 448, height: 600 });
	assert.deepEqual(clampPopupSize({ width: 448.6, height: 500.4 }), { width: 449, height: 500 });
}

function testAvailableHeight(): void {
	// Popup hanging 90px below the top of the usable area on a 900px-tall one.
	assert.equal(availablePopupHeight({ screenY: 115, availTop: 25, availHeight: 900 }), 802);
	// Position unknown: the whole usable height is the bound.
	assert.equal(availablePopupHeight({ screenY: Number.NaN, availTop: 0, availHeight: 700 }), 692);
	assert.equal(availablePopupHeight({ screenY: 0, availTop: 25, availHeight: 700 }), 692);
	assert.equal(availablePopupHeight({ screenY: 0, availTop: 0, availHeight: 0 }), POPUP_LIMITS.maxHeight);
}

function testDrag(): void {
	const start = { width: 448, height: 400 };

	assert.deepEqual(resizedPopupSize(start, 'bottom', 300, 120), { width: 448, height: 520 });
	assert.deepEqual(resizedPopupSize(start, 'bottom-right', 100, 50), { width: 548, height: 450 });
	// The left corner grows the popup by moving left.
	assert.deepEqual(resizedPopupSize(start, 'bottom-left', -100, 50), { width: 548, height: 450 });
	assert.deepEqual(resizedPopupSize(start, 'bottom-left', 500, -500), { width: POPUP_LIMITS.minWidth, height: POPUP_LIMITS.minHeight });
	// Dragging past the bottom of the screen stops at it.
	assert.deepEqual(resizedPopupSize(start, 'bottom', 0, 900, 480), { width: 448, height: 480 });
}

testClamp();
testAvailableHeight();
testDrag();
console.log('popup-size: all checks passed');
