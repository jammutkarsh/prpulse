<script lang="ts">
	import type { ComponentType } from 'svelte';

	type Value = string | boolean;
	interface Option {
		value: Value;
		label: string;
		icon?: ComponentType;
	}
	interface Props {
		name: string;
		value: Value;
		options: Option[];
		onchange: (value: Value) => void;
	}

	let { name, value, options, onchange }: Props = $props();
</script>

<div class="inline-flex shrink-0 rounded-lg border border-soft bg-black/30 p-0.5" role="radiogroup">
	{#each options as option (String(option.value))}
		{@const active = value === option.value}
		<label class={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition focus-within:ring-2 focus-within:ring-(--accent) ${active ? 'bg-(--accent) text-white' : 'text-soft hover:text-white'}`}>
			<input class="sr-only" type="radio" {name} value={String(option.value)} checked={active} onchange={() => onchange(option.value)} />
			{#if option.icon}
				{@const Icon = option.icon}
				<Icon class="h-3.5 w-3.5" />
			{/if}
			{option.label}
		</label>
	{/each}
</div>
