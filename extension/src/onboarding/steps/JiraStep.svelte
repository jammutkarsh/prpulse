<script lang="ts">
	import { ArrowLeft, ArrowRight, Kanban, Link2, Ticket } from 'lucide-svelte';
	import RadioCard from '../../lib/components/RadioCard.svelte';
	import Button from '../../lib/components/Button.svelte';
	import SectionCard from '../../lib/components/SectionCard.svelte';
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
		onNext?: VoidCallback;
		onBack?: VoidCallback;
	}

	let {
		issueTracker = 'jira',
		jiraBaseUrl = '',
		linearWorkspace = '',
		onTrackerChange = () => {},
		onJiraUrlChange = () => {},
		onLinearWorkspaceChange = () => {},
		onNext = () => {},
		onBack = () => {}
	}: Props = $props();

	let isLinear = $derived(issueTracker === 'linear');
	let sample = $derived(isLinear ? { branch: 'ada/eng-1234-login-flow', ticket: 'ENG-1234' } : { branch: 'feat/JIRA-1234/login-flow', ticket: 'JIRA-1234' });
	let previewUrl = $derived(issueLinkFor(sample.branch, { issueTracker, jiraBaseUrl, linearWorkspace })?.url ?? '');
</script>

<SectionCard className="p-6">
	<div class="step-row">
		<div class="step-icon">
			<Link2 class="h-5 w-5" />
		</div>
		<div>
			<h2 class="step-heading">Connect your issue tracker</h2>
			<p class="desc">Map branch names to ticket links now, or skip and configure it later from settings.</p>
		</div>
	</div>
	<div class="space-y-4">
		<div class="grid-2">
			<RadioCard name="issueTracker" value="jira" currentValue={issueTracker} title="Jira" description="Jira Cloud or Data Center." iconComponent={Ticket} onchange={() => onTrackerChange('jira')} />
			<RadioCard name="issueTracker" value="linear" currentValue={issueTracker} title="Linear" description="A Linear workspace." iconComponent={Kanban} onchange={() => onTrackerChange('linear')} />
		</div>
		{#if isLinear}
			<input class="field-input" type="text" value={linearWorkspace} oninput={(e) => onLinearWorkspaceChange(e.currentTarget.value)} placeholder="acme or https://linear.app/acme" />
		{:else}
			<input class="field-input" type="url" value={jiraBaseUrl} oninput={(e) => onJiraUrlChange(e.currentTarget.value)} placeholder="https://company.atlassian.net/browse/PROJ-123" />
		{/if}
		<div class="rounded-lg border border-soft bg-(--bg-panel) p-4 desc">
			<div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-dim">Preview</div>
			<div class="flex flex-wrap items-center gap-2">
				<code class="rounded-lg bg-white/6 px-2 py-1 text-white">{sample.branch}</code>
				<span>→</span>
				{#if previewUrl}
					<a class="link-accent" href={previewUrl} target="_blank" rel="noopener noreferrer">{sample.ticket}</a>
				{:else}
					<span>No {isLinear ? 'Linear workspace' : 'Jira'} configured</span>
				{/if}
			</div>
		</div>
	</div>
	<div class="step-actions">
		<Button variant="secondary" onclick={onBack}><ArrowLeft class="h-4 w-4" />Back</Button>
		<Button onclick={onNext}>Continue<ArrowRight class="h-4 w-4" /></Button>
	</div>
</SectionCard>
