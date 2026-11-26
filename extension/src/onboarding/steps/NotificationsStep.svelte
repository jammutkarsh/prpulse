<script lang="ts">
	import { ArrowRight, Bell, BellOff } from 'lucide-svelte';
	import Button from '../../lib/components/Button.svelte';
	import InfoTip from '../../lib/components/InfoTip.svelte';
	import SegmentedControl from '../../lib/components/SegmentedControl.svelte';
	import type { Settings } from '../../../lib/types';
	import NotificationTest from '../../lib/components/NotificationTest.svelte';

	type VoidCallback = () => void;

	interface Props {
		notificationsEnabled?: Settings['notificationsEnabled'];
		onNotificationsChange?: (value: boolean) => void;
		/** Only the newest section shows its Continue button. */
		active?: boolean;
		onNext?: VoidCallback;
	}

	let {
		notificationsEnabled = null,
		onNotificationsChange = () => {},
		active = true,
		onNext = () => {}
	}: Props = $props();
</script>

<div class="rounded-lg border border-soft text-sm">
	<div class="px-4 py-3">
		<div class="flex items-center justify-between gap-4">
			<span class="flex items-center gap-1.5 font-medium">
				Notifications
				<InfoTip text="Review requests, review verdicts, CI failures and closed PRs. Your filters do not apply. Turning them on asks your browser to confirm; the toolbar badge updates either way." />
			</span>
			<!-- '' while unanswered: skipping keeps null, which is what makes the popup ask later. -->
			<SegmentedControl name="notificationsEnabled" value={notificationsEnabled ?? ''} options={[{ value: true, label: 'On', icon: Bell }, { value: false, label: 'Off', icon: BellOff }]} onchange={(v) => onNotificationsChange(v as boolean)} />
		</div>
		{#if notificationsEnabled}
			<NotificationTest className="mt-3" />
		{/if}
	</div>
</div>
{#if active}
	<div class="mt-4"><Button onclick={onNext}>Continue<ArrowRight class="h-4 w-4" /></Button></div>
{/if}
