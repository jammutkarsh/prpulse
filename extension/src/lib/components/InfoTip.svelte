<script lang="ts">
	import { Info } from 'lucide-svelte';
	import DelayedTooltip from './DelayedTooltip.svelte';

	let { text }: { text: string } = $props();
</script>

<DelayedTooltip {text} delay={200} wrap>
	<button type="button" class="inline-flex text-dim hover:text-white focus-visible:text-white" aria-label={text}>
		<Info class="h-3.5 w-3.5" />
	</button>
</DelayedTooltip>
