<script lang="ts">
	import { PR_SORT_OPTIONS, type PrSort } from '../../lib/pr-view';

	// The list view controls: the repository-list switch, grouping and sort.

	interface Props {
		sortBy?: PrSort;
		/** Whether settings hold any include/exclude patterns. Without them the checkbox has nothing to switch. */
		hasRepoRules?: boolean;
		repoFilterEnabled?: boolean;
		/** PRs in this tab the repository lists are currently hiding. */
		hiddenCount?: number;
		groupByRepo?: boolean;
		onRepoFilterChange?: (value: boolean) => void;
		onGroupByRepoChange?: (value: boolean) => void;
		onSortChange?: (value: PrSort) => void;
	}

	let {
		sortBy = 'default',
		hasRepoRules = false,
		repoFilterEnabled = true,
		hiddenCount = 0,
		groupByRepo = false,
		onRepoFilterChange = () => {},
		onGroupByRepoChange = () => {},
		onSortChange = () => {},
	}: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-soft px-4 py-1.5 text-xs text-soft">
	{#if hasRepoRules}
		<label class="flex cursor-pointer items-center gap-1.5 hover:text-white" title="Apply the include and exclude repository lists from settings">
			<input
				type="checkbox"
				class="rounded border-soft bg-black/40 text-(--accent) focus:ring-(--accent)"
				checked={repoFilterEnabled}
				onchange={(event) => onRepoFilterChange(event.currentTarget.checked)}
			/>
			<span>Repo filter{repoFilterEnabled && hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}</span>
		</label>
	{/if}

	<div class="ml-auto flex items-center gap-1.5">
		<span>View</span>
		<div class="segmented" role="group" aria-label="List view">
			<button type="button" class="segmented-option" aria-pressed={!groupByRepo} onclick={() => onGroupByRepoChange(false)}>List</button>
			<button type="button" class="segmented-option" aria-pressed={groupByRepo} onclick={() => onGroupByRepoChange(true)}>By repo</button>
		</div>
	</div>

	<label class="flex items-center gap-1.5">
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
