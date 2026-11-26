<script lang="ts">
	import { ArrowRight, Eye, EyeOff } from 'lucide-svelte';
	import Button from '../../lib/components/Button.svelte';
	import InfoTip from '../../lib/components/InfoTip.svelte';
	import type { StoredProviderConfig } from '../../../lib/types';

	type VoidCallback = () => void;
	type StringCallback = (value: string) => void;

	interface Props {
		token?: string;
		tokenVisible?: boolean;
		testingConnection?: boolean;
		providerData?: StoredProviderConfig | null;
		/** Only the newest section shows its action button. */
		active?: boolean;
		onTestConnection?: VoidCallback;
		onNext?: VoidCallback;
		onTokenChange?: StringCallback;
		onToggleTokenVisible?: VoidCallback;
	}

	let {
		token = '',
		tokenVisible = false,
		testingConnection = false,
		providerData = null,
		active = true,
		onTestConnection = () => {},
		onNext = () => {},
		onTokenChange = () => {},
		onToggleTokenVisible = () => {}
	}: Props = $props();

	function handlePrimaryAction() {
		if (providerData) {
			onNext();
			return;
		}
		onTestConnection();
	}
</script>

<div class="rounded-lg border border-soft text-sm">
	<div class="space-y-2 px-4 py-3">
		<span class="flex items-center gap-1.5 font-medium">
			Access token
			<InfoTip text="Personal access token with repo access. Authenticate once and the background worker keeps your PRs fresh." />
		</span>
		<div class="relative">
			<input class="field-input pr-12" type={tokenVisible ? 'text' : 'password'} value={token} oninput={(e) => onTokenChange(e.currentTarget.value)} placeholder="ghp_xxxxxxxxxxxxxxxxx" aria-label="GitHub access token" autocomplete="off" />
			<button
				type="button"
				class="absolute right-3 top-1/2 -translate-y-1/2 text-soft transition hover:text-white"
				onclick={onToggleTokenVisible}
				aria-label={tokenVisible ? 'Hide token' : 'Show token'}
				aria-pressed={tokenVisible}
				title={tokenVisible ? 'Hide token' : 'Show token'}
			>
				{#if tokenVisible}
					<EyeOff class="h-4 w-4" />
				{:else}
					<Eye class="h-4 w-4" />
				{/if}
			</button>
		</div>
		<p class="desc">Need a token? <a class="link-accent" href="https://github.com/settings/tokens/new?scopes=repo&description=PR%20Pulse" target="_blank" rel="noopener noreferrer">Create one here</a>.</p>
	</div>
	{#if providerData}
		<div class="flex items-center justify-between gap-4 border-t border-soft px-4 py-3">
			<div class="flex min-w-0 items-center gap-3">
				<img src={providerData.user.avatarUrl} alt="" class="h-7 w-7 shrink-0 rounded-lg border border-soft object-cover" />
				<div class="min-w-0 truncate">
					<span class="label-title">{providerData.user.name || providerData.user.login}</span>
					<span class="text-xs text-dim">@{providerData.user.login}</span>
				</div>
			</div>
			<div class="shrink-0 text-xs text-dim">
				{#if providerData.user.tokenExpiration}
					Expires {new Date(providerData.user.tokenExpiration).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
				{:else if providerData.user.tokenExpiration === null}
					Never expires
				{:else}
					Checking...
				{/if}
			</div>
		</div>
	{/if}
</div>
{#if active}
	<div class="mt-4">
		<Button onclick={handlePrimaryAction} disabled={testingConnection || (!providerData && !token.trim())}>
			{testingConnection ? 'Testing connection...' : providerData ? 'Continue' : 'Test connection'}
			<ArrowRight class="h-4 w-4" />
		</Button>
	</div>
{/if}
