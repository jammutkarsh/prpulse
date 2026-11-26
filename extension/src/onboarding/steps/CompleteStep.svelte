<script lang="ts">
	import { CheckCircle2, RefreshCw } from 'lucide-svelte';
	import Button from '../../lib/components/Button.svelte';
	import SectionCard from '../../lib/components/SectionCard.svelte';
	import InfoTip from '../../lib/components/InfoTip.svelte';
	import InteractiveGuide from '../../lib/components/InteractiveGuide.svelte';
	import { onboardingSyncLabel } from '../../../lib/popup-session';
	import type { Settings } from '../../../lib/types';

	interface Props {
		displayMode?: Settings['displayMode'];
		syncedPrCount?: number;
		/** The first sync is still running, so the count is a running total. */
		syncing?: boolean;
		/** The list on disk is a finished one, not the partial list of a sync that stopped. */
		syncComplete?: boolean;
		onClose?: () => void;
	}

	let { displayMode = 'popup', syncedPrCount = 0, syncing = false, syncComplete = false, onClose = () => {} }: Props = $props();
	let syncLabel = $derived(onboardingSyncLabel(syncing, syncComplete, syncedPrCount));
</script>

<SectionCard>
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<div class="step-icon !p-2"><CheckCircle2 class="h-4 w-4" /></div>
			<h2 class="card-title">You're all set</h2>
			<InfoTip text="Hover over the elements in the sample card to see what each one does." />
		</div>
		{#if syncLabel}
			<div class="inline-flex items-center gap-1.5 rounded-full border border-(--accent-border) bg-(--accent-muted) px-3 py-1 text-xs font-medium text-(--accent)">
				{#if syncing}
					<RefreshCw class="h-3 w-3 animate-spin" />
				{/if}
				<span>{syncLabel}</span>
			</div>
		{/if}
	</div>
	<InteractiveGuide />
	<hr class="my-5 border-soft" />
	<div class="flex items-center justify-between gap-4 rounded-lg border border-soft px-4 py-3 text-sm">
		<span class="text-soft">{displayMode === 'popup' ? 'Pin the extension and click it to open.' : 'Open the dashboard to get started.'}</span>
		<Button onclick={onClose}>{displayMode === 'popup' ? 'Close setup' : 'Open PR Pulse'}</Button>
	</div>
</SectionCard>
