<script lang="ts">
	import { Expand, MonitorSmartphone, PanelRight, Sparkles } from 'lucide-svelte';
	import Button from '../../lib/components/Button.svelte';
	import InfoTip from '../../lib/components/InfoTip.svelte';
	import SegmentedControl from '../../lib/components/SegmentedControl.svelte';
	import type { Settings } from '../../../lib/types';

	type VoidCallback = () => void;

	interface Props {
		displayMode?: Settings['displayMode'];
		completingSetup?: boolean;
		onDisplayModeChange?: (value: Settings['displayMode']) => void;
		onComplete?: VoidCallback;
	}

	let {
		displayMode = 'popup',
		completingSetup = false,
		onDisplayModeChange = () => {},
		onComplete = () => {}
	}: Props = $props();
</script>

<div class="rounded-lg border border-soft text-sm">
	<div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
		<span class="flex items-center gap-1.5 font-medium">
			Open as
			<InfoTip text="What the toolbar button opens. Popup is compact, Full page uses a tab, Sidebar docks beside the page at full height and the button toggles it." />
		</span>
		<SegmentedControl name="displayMode" value={displayMode} options={[{ value: 'popup', label: 'Popup', icon: MonitorSmartphone }, { value: 'fullpage', label: 'Full page', icon: Expand }, { value: 'sidebar', label: 'Sidebar', icon: PanelRight }]} onchange={(v) => onDisplayModeChange(v as Settings['displayMode'])} />
	</div>
</div>
<div class="mt-4">
	<Button onclick={onComplete} disabled={completingSetup}>
		{completingSetup ? 'Finishing setup...' : 'Complete setup'}
		<Sparkles class="h-4 w-4" />
	</Button>
</div>
