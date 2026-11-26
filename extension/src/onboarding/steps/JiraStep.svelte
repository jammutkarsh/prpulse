<script lang="ts">
	import { ArrowRight, Kanban, Ticket } from 'lucide-svelte';
	import Button from '../../lib/components/Button.svelte';
	import InfoTip from '../../lib/components/InfoTip.svelte';
	import SegmentedControl from '../../lib/components/SegmentedControl.svelte';
	import { issueLinkFor } from '../../../lib/issue-tracker';
	import type { Settings } from '../../../lib/types';

	type VoidCallback = () => void;

	interface Props {
		issueTracker?: Settings['issueTracker'];
		jiraBaseUrl?: string;
		linearWorkspace?: string;
		onTrackerChange?: (value: Settings['issueTracker']) => void;
		onJiraUrlChange?: (value: string) => void;
		onLinearWorkspaceChange?: (value: string) => void;
		/** Only the newest section shows its Continue button. */
		active?: boolean;
		onNext?: VoidCallback;
	}

	let {
		issueTracker = 'jira',
		jiraBaseUrl = '',
		linearWorkspace = '',
		onTrackerChange = () => {},
		onJiraUrlChange = () => {},
		onLinearWorkspaceChange = () => {},
		active = true,
		onNext = () => {}
	}: Props = $props();

	let isLinear = $derived(issueTracker === 'linear');
	let sample = $derived(isLinear ? { branch: 'ada/eng-1234-login-flow', ticket: 'ENG-1234' } : { branch: 'feat/JIRA-1234/login-flow', ticket: 'JIRA-1234' });
	let previewUrl = $derived(issueLinkFor(sample.branch, { issueTracker, jiraBaseUrl, linearWorkspace })?.url ?? '');
</script>

{#snippet label(text: string, tip: string)}
	<span class="flex items-center gap-1.5 font-medium">
		{text}
		<InfoTip text={tip} />
	</span>
{/snippet}

<div class="rounded-lg border border-soft text-sm">
	<div class="flex items-center justify-between gap-4 px-4 py-3">
		{@render label('Tracker', 'Optional. Branch names containing a ticket id link to it. Leave the field empty to skip.')}
		<SegmentedControl name="issueTracker" value={issueTracker} options={[{ value: 'jira', label: 'Jira', icon: Ticket }, { value: 'linear', label: 'Linear', icon: Kanban }]} onchange={(v) => onTrackerChange(v as Settings['issueTracker'])} />
	</div>
	<div class="space-y-2 border-t border-soft px-4 py-3">
		{#if isLinear}
			{@render label('Workspace', 'Your Linear workspace name or URL.')}
			<input class="field-input" type="text" value={linearWorkspace} oninput={(e) => onLinearWorkspaceChange(e.currentTarget.value)} placeholder="acme or https://linear.app/acme" aria-label="Linear workspace" />
		{:else}
			{@render label('Jira URL', 'Jira Cloud or Data Center. Paste your Jira address or any issue URL.')}
			<input class="field-input" type="url" value={jiraBaseUrl} oninput={(e) => onJiraUrlChange(e.currentTarget.value)} placeholder="https://company.atlassian.net/browse/PROJ-123" aria-label="Jira URL" />
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-2 border-t border-soft px-4 py-3 desc">
		<code class="rounded-lg bg-white/6 px-2 py-1 text-white">{sample.branch}</code>
		<span>→</span>
		{#if previewUrl}
			<a class="link-accent" href={previewUrl} target="_blank" rel="noopener noreferrer">{sample.ticket}</a>
		{:else}
			<span>No {isLinear ? 'Linear workspace' : 'Jira'} configured</span>
		{/if}
	</div>
</div>
{#if active}
	<div class="mt-4"><Button onclick={onNext}>Continue<ArrowRight class="h-4 w-4" /></Button></div>
{/if}
