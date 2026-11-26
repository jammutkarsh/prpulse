<script lang="ts">
	import { onDestroy, onMount, tick, type ComponentType } from 'svelte';
	import { Bell, Github, LayoutPanelLeft, Link2, MonitorSmartphone } from 'lucide-svelte';
	import { permissionsRequest, runtimeGetURL, storageOnChangedAddListener, type StorageChangeMap } from '../../lib/extension-api';
	import { storage } from '../../lib/storage';
	import { DEFAULT_SETTINGS } from '../../lib/ui-config';
	import type { PullRequestData, Settings, StoredProviderConfig, SyncStatus } from '../../lib/types';
	import { activeSync } from '../../lib/popup-session';
	import { commitJiraUrl } from '../../lib/jira';
	import { commitLinearWorkspace } from '../../lib/linear';
	import { parseRepoPatterns } from '../../lib/repo-filter';
	import { commitProvider, connectGithubToken } from '../../lib/github-connect';
	import GithubStep from './steps/GithubStep.svelte';
	import DefaultViewStep from './steps/DefaultViewStep.svelte';
	import JiraStep from './steps/JiraStep.svelte';
	import NotificationsStep from './steps/NotificationsStep.svelte';
	import DisplayStep from './steps/DisplayStep.svelte';
	import CompleteStep from './steps/CompleteStep.svelte';
	import InfoTip from '../lib/components/InfoTip.svelte';
	import SectionCard from '../lib/components/SectionCard.svelte';
	import AttributionFooter from '../lib/components/AttributionFooter.svelte';

	const STEP_GITHUB = 1;
	const STEP_DEFAULT_VIEW = 2;
	const STEP_JIRA = 3;
	const STEP_NOTIFICATIONS = 4;
	const STEP_DISPLAY = 5;
	const STEP_COMPLETE = 6;
	type OnboardingSettings = Pick<Settings, 'pinnedTab' | 'issueTracker' | 'jiraBaseUrl' | 'linearWorkspace' | 'displayMode' | 'notificationsEnabled' | 'groupByRepo' | 'repoFilterEnabled'>;
	type OnboardingSessionState = {
		currentStep?: number;
		providerData?: StoredProviderConfig | null;
		settings?: Partial<OnboardingSettings>;
		repoIncludeText?: string;
		repoExcludeText?: string;
		token?: string;
	};

	const steps: { id: number; title: string; icon: ComponentType; tip: string }[] = [
		{ id: STEP_GITHUB, title: 'GitHub', icon: Github, tip: 'Connect your account so PR Pulse can read your pull requests.' },
		{ id: STEP_DEFAULT_VIEW, title: 'Default view', icon: LayoutPanelLeft, tip: 'How the list looks when you open it. All optional; change any of it later in Settings.' },
		{ id: STEP_JIRA, title: 'Issue tracker', icon: Link2, tip: 'Map branch names to ticket links now, or skip and configure it later in Settings.' },
		{ id: STEP_NOTIFICATIONS, title: 'Notifications', icon: Bell, tip: 'Get told when a PR needs you, without watching the toolbar badge. Optional.' },
		{ id: STEP_DISPLAY, title: 'Display', icon: MonitorSmartphone, tip: 'Start compact in the popup, dock it in the sidebar, or open a full-page workspace.' },
	];

	let currentStep = $state<number>(STEP_GITHUB);
	let providerData = $state<StoredProviderConfig | null>(null);
	let settings = $state<OnboardingSettings>({
		pinnedTab: DEFAULT_SETTINGS.pinnedTab,
		issueTracker: DEFAULT_SETTINGS.issueTracker,
		jiraBaseUrl: DEFAULT_SETTINGS.jiraBaseUrl,
		linearWorkspace: DEFAULT_SETTINGS.linearWorkspace,
		displayMode: DEFAULT_SETTINGS.displayMode,
		groupByRepo: DEFAULT_SETTINGS.groupByRepo,
		repoFilterEnabled: DEFAULT_SETTINGS.repoFilterEnabled,
		// Left unanswered on purpose: skipping the step keeps `null`, which is what makes the popup ask later.
		notificationsEnabled: DEFAULT_SETTINGS.notificationsEnabled,
	});
	// Raw text, parsed on finish: an invalid line is skipped there rather than blocking setup.
	let repoIncludeText = $state('');
	let repoExcludeText = $state('');
	let token = $state('');
	let tokenVisible = $state(false);
	let testingConnection = $state(false);
	let errorMessage = $state('');
	let completingSetup = $state(false);
	let onboardingStateReady = $state(false);
	let syncedPrCount = $state(0);
	// The first sync runs on after setup finishes; the last step counts PRs as they land.
	let syncing = $state(false);
	let syncComplete = $state(false);
	let stopSyncWatch: (() => void) | null = null;
	onDestroy(() => stopSyncWatch?.());

	onMount(() => {
		const saved = sessionStorage.getItem('prPulseOnboarding');
		if (saved) {
			try {
				const state = JSON.parse(saved) as OnboardingSessionState;
				if (state.settings) settings = { ...settings, ...state.settings };
				if (state.token) token = state.token;
				repoIncludeText = state.repoIncludeText ?? '';
				repoExcludeText = state.repoExcludeText ?? '';
				if (state.providerData) providerData = state.providerData;
				if (state.currentStep) currentStep = Math.min(STEP_COMPLETE, Math.max(STEP_GITHUB, state.currentStep));
			} catch {
				// ignore invalid state
			}
		}
		onboardingStateReady = true;
	});

	$effect(() => {
		if (onboardingStateReady) {
			sessionStorage.setItem('prPulseOnboarding', JSON.stringify({ currentStep, providerData, settings, token, repoIncludeText, repoExcludeText }));
		}
	});

	async function testConnection() {
		errorMessage = '';
		testingConnection = true;

		try {
			const result = await connectGithubToken(token);
			if (result.status === 'connected') {
				providerData = result.provider;
				return;
			}

			errorMessage = result.error;
		} finally {
			testingConnection = false;
		}
	}

	async function nextStep() {
		if (currentStep === STEP_JIRA) {
			// Only the selected tracker's field is on screen, so only that one can block the step.
			if (settings.issueTracker === 'linear') {
				const committed = commitLinearWorkspace(settings.linearWorkspace);
				if (committed === null) {
					errorMessage = 'Please enter a Linear workspace name or URL, or leave the field empty.';
					return;
				}
				settings = { ...settings, linearWorkspace: committed };
			} else {
				const committed = commitJiraUrl(settings.jiraBaseUrl);
				if (committed === null) {
					errorMessage = 'Please enter a valid Jira URL or leave the field empty.';
					return;
				}
				settings = { ...settings, jiraBaseUrl: committed };
			}
		}

		errorMessage = '';
		currentStep = Math.min(STEP_DISPLAY, currentStep + 1);
		await tick();
		document.getElementById(`step-${currentStep}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/**
	 * Called straight from the card's click, which is what keeps the user gesture the permission request
	 * needs. A decline records `false` rather than an on setting that could never fire.
	 */
	async function updateNotifications(enabled: boolean) {
		settings = { ...settings, notificationsEnabled: enabled && (await permissionsRequest(['notifications'])) };
	}

	// Kept raw while typing: sanitising per keystroke eats the trailing `/` and a context path can't be typed.
	function updateJiraUrl(value: string) {
		settings = { ...settings, jiraBaseUrl: value };
	}

	async function completeSetup() {
		if (!providerData) {
			errorMessage = 'Connect your GitHub account first.';
			currentStep = STEP_GITHUB;
			return;
		}

		completingSetup = true;
		errorMessage = '';

		try {
			// Settings first: the worker reads them the moment the provider commit wakes it.
			await storage.setSettings({
				...settings,
				repoInclude: parseRepoPatterns(repoIncludeText).patterns,
				repoExclude: parseRepoPatterns(repoExcludeText).patterns,
				jiraBaseUrl: commitJiraUrl(settings.jiraBaseUrl) ?? '',
				linearWorkspace: commitLinearWorkspace(settings.linearWorkspace) ?? '',
			});

			// Follow the worker's first sync from here on. Nothing waits for it: with many PRs it takes tens
			// of seconds, and the last step is useful long before it ends.
			stopSyncWatch?.();
			syncing = true;
			syncComplete = false;
			stopSyncWatch = storageOnChangedAddListener((changes: StorageChangeMap, areaName: string) => {
				if (areaName !== 'local') return;
				const data = changes.pullRequests?.newValue as PullRequestData | undefined;
				if (data) {
					syncedPrCount = (data.myPRs?.length || 0) + (data.reviewRequests?.length || 0);
					syncComplete = data.lastFetched !== null;
				}
				const status = changes.syncStatus?.newValue as SyncStatus | undefined;
				if (changes.syncStatus) {
					syncing = activeSync(status) !== null;
				}
			});

			await commitProvider(providerData);
			currentStep = STEP_COMPLETE;
		} catch (error) {
			console.error('Setup failed:', error);
			stopSyncWatch?.();
			stopSyncWatch = null;
			syncing = false;
			errorMessage = 'Failed to complete setup. Please try again.';
		} finally {
			completingSetup = false;
		}
	}

	function closeSetup() {
		sessionStorage.removeItem('prPulseOnboarding');

		if (settings.displayMode === 'fullpage') {
			window.location.href = runtimeGetURL('popup/popup.html?fullpage=1');
			return;
		}

		window.close();
	}
</script>

{#snippet head(Icon: ComponentType, title: string, tip: string)}
	<div class="mb-3 flex items-center gap-3">
		<div class="step-icon !p-2"><Icon class="h-4 w-4" /></div>
		<h2 class="card-title">{title}</h2>
		<InfoTip text={tip} />
	</div>
{/snippet}

<div class="page-screen">
	<div class="page-wrap">
		<div class="surface-card-padded">
			<div class="max-w-xl space-y-2">
				<div class="section-title">Setup</div>
				<h1 class="text-3xl font-semibold text-white">Configure PR Pulse</h1>
				{#if !onboardingStateReady}
					<p class="body-text">Restoring your onboarding progress...</p>
				{/if}
			</div>
		</div>

		{#if onboardingStateReady}
			{#if currentStep === STEP_COMPLETE}
				<CompleteStep
					displayMode={settings.displayMode}
					{syncedPrCount}
					{syncing}
					{syncComplete}
					onClose={closeSetup}
				/>
			{:else}
				<SectionCard>
					{#each steps as step (step.id)}
						{#if currentStep >= step.id}
							{#if step.id > STEP_GITHUB}<hr class="my-5 border-soft" />{/if}
							<div id={`step-${step.id}`} class="scroll-mt-4">
								{@render head(step.icon, step.title, step.tip)}
								{#if step.id === STEP_GITHUB}
									<GithubStep
										{token}
										{tokenVisible}
										{testingConnection}
										{providerData}
										active={currentStep === step.id}
										onTestConnection={testConnection}
										onNext={nextStep}
										onTokenChange={(val) => token = val}
										onToggleTokenVisible={() => tokenVisible = !tokenVisible}
									/>
								{:else if step.id === STEP_DEFAULT_VIEW}
									<DefaultViewStep
										pinnedTab={settings.pinnedTab}
										onPinnedTabChange={(val) => settings = { ...settings, pinnedTab: val }}
										groupByRepo={settings.groupByRepo}
										onGroupByRepoChange={(groupByRepo) => settings = { ...settings, groupByRepo }}
										repoFilterEnabled={settings.repoFilterEnabled}
										onRepoFilterEnabledChange={(repoFilterEnabled) => settings = { ...settings, repoFilterEnabled }}
										{repoIncludeText}
										{repoExcludeText}
										onRepoFiltersChange={(include, exclude) => { repoIncludeText = include; repoExcludeText = exclude; }}
										active={currentStep === step.id}
										onNext={nextStep}
									/>
								{:else if step.id === STEP_JIRA}
									<JiraStep
										issueTracker={settings.issueTracker}
										jiraBaseUrl={settings.jiraBaseUrl}
										linearWorkspace={settings.linearWorkspace}
										onTrackerChange={(issueTracker) => { errorMessage = ''; settings = { ...settings, issueTracker }; }}
										onJiraUrlChange={updateJiraUrl}
										onLinearWorkspaceChange={(linearWorkspace) => { settings = { ...settings, linearWorkspace }; }}
										active={currentStep === step.id}
										onNext={nextStep}
									/>
								{:else if step.id === STEP_NOTIFICATIONS}
									<NotificationsStep
										notificationsEnabled={settings.notificationsEnabled}
										onNotificationsChange={updateNotifications}
										active={currentStep === step.id}
										onNext={nextStep}
									/>
								{:else}
									<DisplayStep
										displayMode={settings.displayMode}
										{completingSetup}
										onDisplayModeChange={(val) => settings = { ...settings, displayMode: val }}
										onComplete={completeSetup}
									/>
								{/if}
							</div>
						{/if}
					{/each}
					{#if errorMessage}
						<div class="danger-surface mt-4 rounded-lg border px-4 py-3 text-sm text-(--danger)">
							{errorMessage}
						</div>
					{/if}
				</SectionCard>
			{/if}
		{/if}

		<AttributionFooter />
	</div>
</div>
