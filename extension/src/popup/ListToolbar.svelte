<script lang="ts">
	import { PR_SORT_OPTIONS, type PrSort } from '../../lib/pr-view';

	// How the list is arranged, as opposed to what is in it: the search panel owns the latter.

	interface Props {
		groupByRepo?: boolean;
		sortBy?: PrSort;
		onGroupByRepoChange?: (value: boolean) => void;
		onSortChange?: (value: PrSort) => void;
	}

	let {
		groupByRepo = false,
		sortBy = 'updated',
		onGroupByRepoChange = () => {},
		onSortChange = () => {},
	}: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-soft px-4 py-1.5 text-xs text-soft">
	<label class="flex cursor-pointer items-center gap-1.5 hover:text-white">
		<input
			type="checkbox"
			class="rounded border-soft bg-black/40 text-(--accent) focus:ring-(--accent)"
			checked={groupByRepo}
			onchange={(event) => onGroupByRepoChange(event.currentTarget.checked)}
		/>
		<span>Group by repo</span>
	</label>

	<label class="ml-auto flex items-center gap-1.5">
		<span>Sort</span>
		<select
			class="cursor-pointer rounded border border-soft bg-(--bg-panel-strong) px-1.5 py-0.5 text-xs text-white outline-none focus:border-(--accent)"
			value={sortBy}
			onchange={(event) => onSortChange(event.currentTarget.value as PrSort)}
		>
			{#each PR_SORT_OPTIONS as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
</div>
