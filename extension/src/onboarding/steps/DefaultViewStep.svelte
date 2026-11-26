<script lang="ts">
	import { ArrowRight, GitPullRequest, Inbox } from 'lucide-svelte';
	import InfoTip from '../../lib/components/InfoTip.svelte';
	import { parseRepoPatterns } from '../../../lib/repo-filter';
	import Button from '../../lib/components/Button.svelte';
	import SegmentedControl from '../../lib/components/SegmentedControl.svelte';
	import type { Settings } from '../../../lib/types';

	type VoidCallback = () => void;

	interface Props {
		pinnedTab?: Settings['pinnedTab'];
		onPinnedTabChange?: (value: Settings['pinnedTab']) => void;
		groupByRepo?: boolean;
		onGroupByRepoChange?: (value: boolean) => void;
		repoFilterEnabled?: boolean;
		onRepoFilterEnabledChange?: (value: boolean) => void;
		repoIncludeText?: string;
		repoExcludeText?: string;
		onRepoFiltersChange?: (include: string, exclude: string) => void;
		/** Only the newest section shows its Continue button. */
		active?: boolean;
		onNext?: VoidCallback;
	}

	let {
		pinnedTab = 'myPRs',
		onPinnedTabChange = () => {},
		groupByRepo = false,
		onGroupByRepoChange = () => {},
		repoFilterEnabled = false,
		onRepoFilterEnabledChange = () => {},
		repoIncludeText = '',
		repoExcludeText = '',
		onRepoFiltersChange = () => {},
		active = true,
		onNext = () => {}
	}: Props = $props();

	let ignored = $derived([...parseRepoPatterns(repoIncludeText).invalid, ...parseRepoPatterns(repoExcludeText).invalid]);
</script>

{#snippet label(text: string, tip: string)}
	<span class="flex items-center gap-1.5 font-medium">
		{text}
		<InfoTip text={tip} />
	</span>
{/snippet}

<div class="rounded-lg border border-soft text-sm">
	<div class="flex items-center justify-between gap-4 px-4 py-3">
		{@render label('Default tab', 'The tab the popup opens on: pull requests you authored, or ones waiting on your review.')}
		<SegmentedControl name="pinnedTab" value={pinnedTab} options={[{ value: 'myPRs', label: 'My PRs', icon: GitPullRequest }, { value: 'toReview', label: 'To review', icon: Inbox }]} onchange={(v) => onPinnedTabChange(v as Settings['pinnedTab'])} />
	</div>
	<label class="flex cursor-pointer items-center justify-between gap-4 border-t border-soft px-4 py-3">
		{@render label('Group by repository', 'Show the list under one heading per repository.')}
		<input type="checkbox" class="h-4 w-4 rounded border-soft bg-black/40 text-(--accent) focus:ring-(--accent)" checked={groupByRepo} onchange={(e) => onGroupByRepoChange(e.currentTarget.checked)} />
	</label>
	<div class="border-t border-soft px-4 py-3">
		<label class="flex cursor-pointer items-center justify-between gap-4">
			{@render label('Limit repositories', 'Only show repositories matching owner/repo patterns, one per line; * is a wildcard. Exclude wins over include.')}
			<input type="checkbox" class="h-4 w-4 rounded border-soft bg-black/40 text-(--accent) focus:ring-(--accent)" checked={repoFilterEnabled} onchange={(e) => onRepoFilterEnabledChange(e.currentTarget.checked)} />
		</label>
		{#if repoFilterEnabled}
			<div class="grid-2 mt-3">
				<textarea class="field-input font-mono" rows="3" spellcheck="false" aria-label="Include repositories" value={repoIncludeText} oninput={(e) => onRepoFiltersChange(e.currentTarget.value, repoExcludeText)} placeholder="Include: acme/*"></textarea>
				<textarea class="field-input font-mono" rows="3" spellcheck="false" aria-label="Exclude repositories" value={repoExcludeText} oninput={(e) => onRepoFiltersChange(repoIncludeText, e.currentTarget.value)} placeholder="Exclude: acme/legacy-*"></textarea>
			</div>
			{#if ignored.length > 0}
				<p class="desc mt-2">Will be skipped: {ignored.join(', ')}</p>
			{/if}
		{/if}
	</div>
</div>
{#if active}
	<div class="mt-4"><Button onclick={onNext}>Continue<ArrowRight class="h-4 w-4" /></Button></div>
{/if}
