<script lang="ts">
	import { onMount } from 'svelte';
	import { availablePopupHeight, clampPopupSize, resizedPopupSize, type PopupSize, type ResizeEdge } from '../../lib/popup-size';

	// Drag handles along the popup's bottom edge. The browser sizes an action popup to its content, so
	// resizing is just changing the frame's CSS size; this owns that and reports where a drag ended.

	interface Props {
		/** The size to return to on a double-click. */
		defaultSize: PopupSize;
		/** A drag (or reset) finished at this size. */
		onResize?: (size: PopupSize) => void;
	}

	let { defaultSize, onResize = () => {} }: Props = $props();

	let drag: { x: number; y: number; start: PopupSize; edge: ResizeEdge; last: PopupSize } | null = null;

	function availableHeight(): number {
		const screenInfo = window.screen as Screen & { availTop?: number };
		return availablePopupHeight({
			screenY: window.screenY,
			availTop: screenInfo.availTop ?? 0,
			availHeight: screenInfo.availHeight,
		});
	}

	function currentSize(): PopupSize {
		const frame = document.querySelector<HTMLElement>('.popup-frame');
		return { width: frame?.offsetWidth ?? defaultSize.width, height: frame?.offsetHeight ?? defaultSize.height };
	}

	function apply(size: PopupSize): void {
		const root = document.documentElement;
		root.style.setProperty('--popup-width', `${size.width}px`);
		root.style.setProperty('--popup-height', `${size.height}px`);
	}

	/** A size remembered on a taller display must not hang off the bottom of this one. */
	function fitToScreen(): void {
		const current = currentSize();
		const fitted = clampPopupSize(current, availableHeight());
		if (fitted.width !== current.width || fitted.height !== current.height) {
			apply(fitted);
		}
	}

	onMount(() => {
		fitToScreen();
		// The browser positions the panel a moment after it first lays out; only then is `screenY` real.
		const timer = setTimeout(fitToScreen, 250);
		return () => clearTimeout(timer);
	});

	function startDrag(event: PointerEvent, edge: ResizeEdge): void {
		if (event.button !== 0) return;

		event.preventDefault();
		// Capture keeps the moves coming once the pointer is past the popup's edge, which is where a
		// drag that makes it bigger spends most of its time.
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		const start = currentSize();
		drag = { x: event.screenX, y: event.screenY, start, edge, last: start };
	}

	function moveDrag(event: PointerEvent): void {
		if (!drag) return;

		drag.last = resizedPopupSize(drag.start, drag.edge, event.screenX - drag.x, event.screenY - drag.y, availableHeight());
		apply(drag.last);
	}

	function endDrag(): void {
		if (!drag) return;

		const { start, last } = drag;
		drag = null;
		if (last.width !== start.width || last.height !== start.height) {
			onResize(last);
		}
	}

	function reset(): void {
		const size = clampPopupSize(defaultSize, availableHeight());
		apply(size);
		onResize(size);
	}
</script>

{#snippet handle(edge: ResizeEdge, classes: string)}
	<div
		class={`popup-resize-handle ${classes}`}
		role="separator"
		aria-label="Resize popup"
		title="Drag to resize, double-click to reset"
		onpointerdown={(event) => startDrag(event, edge)}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		ondblclick={reset}
	></div>
{/snippet}

{@render handle('bottom', 'popup-resize-bottom')}
{@render handle('bottom-left', 'popup-resize-corner popup-resize-left')}
{@render handle('bottom-right', 'popup-resize-corner popup-resize-right')}
