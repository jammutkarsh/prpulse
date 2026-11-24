<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { FolderGit2 } from 'lucide-svelte';
	import PopupHeader from './PopupHeader.svelte';
	import PrCard from './PrCard.svelte';
	import PopupStates from './PopupStates.svelte';
	import SearchFilter from './SearchFilter.svelte';
	import ListToolbar from './ListToolbar.svelte';
	import PopupResizer from './PopupResizer.svelte';
	import AttributionFooter from '../lib/components/AttributionFooter.svelte';
	import NotificationTest from '../lib/components/NotificationTest.svelte';
	import {
		runtimeGetURL,
		storageOnChangedAddListener,
		runtimeSendMessage,
		tabsCreate,
		permissionsRequest,
		type StorageChangeMap,
		type Unsubscribe,
	} from '../../lib/extension-api';
	import { storage } from '../../lib/storage';
	import type { PopupFilters, PopupTab, PullRequest, PullRequestData, Settings, SyncStatus } from '../../lib/types';
	import { createPopupSession, type PopupState } from '../../lib/popup-session';
	import { DEFAULT_SETTINGS, normalizeSettings } from '../../lib/ui-config';
	import type { PopupSize } from '../../lib/popup-size';
	import { applyRepoFilter, hasRepoRules } from '../../lib/repo-filter';
	import { createDefaultFilters, createPrView, groupByRepo, sameFilters, sortPullRequests } from '../../lib/pr-view';
	import {
		copyToClipboard,
		formatRelativeTime,
		isValidHttpUrl,
	} from '../../lib/utils';

	type PopupBootstrapData = Awaited<ReturnType<typeof storage.getBootstrapData>>;

	interface Props {
		bootstrapDataPromise?: Promise<PopupBootstrapData> | null;
	}

	let { bootstrapDataPromise = null }: Props = $props();

	// One read, shared: the session bootstraps from it and the display-mode check reads it first.
	const bootstrapPromise = untrack(() => bootstrapDataPromise) ?? storage.getBootstrapData();
	const session = createPopupSession({
		storage,
		sendMessage: runtimeSendMessage,
		bootstrap: bootstrapPromise,
		requestNotificationPermission: () => permissionsRequest(['notifications']),
	});

	let popup = $state<PopupState>(session.getState());
	let unsubscribeSession: Unsubscribe | null = null;
	let unsubscribeStorage: Unsubscribe | null = null;

	// Everything below is the popup's own surface state: what is open, what just got copied, what the
	// toast says. The session owns the rest.
	let isFullpageMode = $state(false);
	// Docked in the browser's sidebar. Fixed for the life of the page, unlike the redirect-driven flag above.
	const isSidebarMode = new URLSearchParams(window.location.search).has('sidebar');
	// The sidebar and the full page stay open for hours; this keeps "Updated 3m ago" honest between syncs.
	let clock = $state(0);
	let clockTimer: ReturnType<typeof setInterval> | null = null;
	let refreshInProgress = $state(false);
	let copiedItemId = $state<string | null>(null);
	let toastMessage = $state('');
	let toastType = $state<'info' | 'warning' | 'error' | 'success'>('info');
	let toastVisible = $state(false);
	let isSearchOpen = $state(false);
	let isFilterOpen = $state(false);
	let searchQuery = $state('');
	let activeFilters = $state<PopupFilters>(createDefaultFilters());
	// Only for the rest of this popup session: somewhere to offer the test before the row goes away.
	let justEnabled = $state(false);
	function handleKeydown(event: KeyboardEvent) {
		const isFindShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f';
		if (!isFindShortcut || !showSearchControls) return;

		event.preventDefault();
		isSearchOpen = true;
		isFilterOpen = true;
	}

	onMount(() => {
		unsubscribeSession = session.subscribe((next) => {
			popup = next;
		});
		void init();
		window.addEventListener('keydown', handleKeydown);
		clockTimer = setInterval(() => {
			clock += 1;
		}, 30_000);
	});

	onDestroy(() => {
		unsubscribeStorage?.();
		unsubscribeSession?.();
		if (clockTimer) clearInterval(clockTimer);
		window.removeEventListener('keydown', handleKeydown);
	});

	function onStorageChanged(changes: StorageChangeMap, areaName: string) {
		if (areaName !== 'local') return;
		if (changes.syncStatus) {
			session.applySyncStatus(changes.syncStatus.newValue as SyncStatus | undefined);
		}
		// A cleared key normalizes back to the defaults, same as the next open would read.
		if (changes.settings) {
			session.applySettings(normalizeSettings(changes.settings.newValue as Partial<Settings> | undefined));
		}
		if (changes.pullRequests?.newValue) {
			session.applyPullRequests(changes.pullRequests.newValue as PullRequestData);
		}
	}

	async function redirectToFullpage(bootstrapSettings: Settings): Promise<boolean> {
		isFullpageMode = new URLSearchParams(window.location.search).has('fullpage');

		// The sidebar can be opened from the browser's own menu whatever the display mode is; it stays put.
		if (bootstrapSettings.displayMode === 'fullpage' && !isFullpageMode && !isSidebarMode) {
			await tabsCreate({ url: runtimeGetURL('popup/popup.html?fullpage=1') });
			window.close();
			return true;
		}

		return false;
	}

	async function init() {
		const { settings: bootstrapSettings } = await bootstrapPromise;
		if (await redirectToFullpage(bootstrapSettings)) return;

		await session.open();
		activeFilters = popup.filters;
		unsubscribeStorage = storageOnChangedAddListener(onStorageChanged);
	}

	async function refreshPrs() {
		refreshInProgress = true;
		const result = await session.refresh();
		refreshInProgress = false;

		if (result.ok) {
			showToast(result.message, 'success');
			return;
		}

		// A dead token is already on screen as the error banner; a toast would say it twice.
		if (result.message !== popup.errorMessage) {
			showToast(result.message, popup.setupRequired ? 'warning' : 'error');
		}
	}

	function showToast(message: string, type: typeof toastType = 'info') {
		toastMessage = message;
		toastType = type;
		toastVisible = true;
		setTimeout(() => {
			toastVisible = false;
		}, 2500);
	}

	function openSetup() {
		const target = runtimeGetURL('onboarding/onboarding.html');
		if (isFullpageMode) {
			window.location.href = target;
			return;
		}

		void tabsCreate({ url: target });
	}

	function openSettings() {
		const target = runtimeGetURL('settings/settings.html');
		if (isFullpageMode) {
			window.location.href = target;
			return;
		}

		void tabsCreate({ url: target });
	}

	function openFullscreen() {
		void tabsCreate({ url: runtimeGetURL('popup/popup.html?fullpage=1') });
	}

	async function enableNotifications() {
		// No await before this line: the permission request needs the click's user gesture.
		justEnabled = await session.setNotifications(true);
		showToast(justEnabled ? 'Notifications on' : 'Notifications stay off', justEnabled ? 'success' : 'info');
	}

	// The stored config is in rem, like the rest of the UI config; the handles work in pixels.
	function rootFontSize(): number {
		return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	}

	function defaultPopupSize(): PopupSize {
		const rem = rootFontSize();
		return { width: DEFAULT_SETTINGS.ui.popupWidthRem * rem, height: DEFAULT_SETTINGS.ui.popupHeightRem * rem };
	}

	function rememberPopupSize(size: PopupSize) {
		const rem = rootFontSize();
		void session.updateSettings({
			ui: { ...popup.settings.ui, popupWidthRem: size.width / rem, popupHeightRem: size.height / rem },
		});
	}

	function toggleSearch() {
		if (!isSearchOpen) {
			isSearchOpen = true;
			isFilterOpen = true;
			return;
		}

		isSearchOpen = false;
		isFilterOpen = false;
	}

	function handleTabChange(tab: PopupTab) {
		session.setTab(tab);
		activeFilters = popup.filters;
		isFilterOpen = false;
	}

	function safeOpenUrl(url: string) {
		if (!isValidHttpUrl(url)) {
			return;
		}

		void tabsCreate({ url });
	}

	async function handleCopy(value: string, id: string) {
		await copyToClipboard(value);
		copiedItemId = id;
		setTimeout(() => {
			if (copiedItemId === id) {
				copiedItemId = null;
			}
		}, 1000);
	}

	let loading = $derived(popup.loading);
	let setupRequired = $derived(popup.setupRequired);
	let errorMessage = $derived(popup.errorMessage);
	let provider = $derived(popup.provider);
	let settings = $derived(popup.settings);
	let currentTab = $derived(popup.tab);
	let prData = $derived(popup.pullRequests);
	let newPrCount = $derived(popup.newPrCount);
	let sync = $derived(popup.sync);
	let syncing = $derived(refreshInProgress || sync !== null);

	// The repository lists from settings come first: the counts, the filter options and the list all
	// describe what is left, and only the toolbar's checkbox knows anything was held back.
	let myItems = $derived(applyRepoFilter(prData.myPRs || [], settings));
	let reviewItems = $derived(applyRepoFilter(prData.reviewRequests || [], settings));
	let tabTotal = $derived((currentTab === 'myPRs' ? prData.myPRs : prData.reviewRequests)?.length || 0);
	let currentItems = $derived(currentTab === 'myPRs' ? myItems : reviewItems);
	let myPrCount = $derived(myItems.length);
	let reviewCount = $derived(reviewItems.length);
	let repoHiddenCount = $derived(tabTotal - currentItems.length);
	let syncText = $derived(sync && sync.total > 0 ? `Syncing… ${Math.min(sync.loaded, sync.total)} of ${sync.total} PRs` : 'Syncing…');
	let lastUpdatedText = $derived.by(() => {
		// Read only to re-run on the tick: the relative time goes stale without it.
		void clock;
		if (syncing) return syncText;
		return prData.lastFetched ? `Updated ${formatRelativeTime(prData.lastFetched)}` : 'Waiting for first sync';
	});
	let fullpageShellClasses = $derived(isFullpageMode ? 'w-full max-w-[80rem]' : 'h-full');
	let cardListClasses = $derived(isFullpageMode ? 'grid gap-3 xl:grid-cols-2' : 'popup-card-grid pr-1 scroll-thin');
	let view = $derived(createPrView(currentItems, activeFilters, searchQuery, currentTab));
	// A search result is already ranked by relevance; re-sorting it would bury the best match.
	let filteredItems = $derived(searchQuery.trim() ? view.items : sortPullRequests(view.items, settings.sortBy));
	let repoGroups = $derived(settings.groupByRepo ? groupByRepo(filteredItems) : []);
	let filterCount = $derived(view.filterCount);
	let filterActive = $derived(filterCount > 0);
	let showSearchControls = $derived(!loading && !setupRequired && currentItems.length > 0);
	// Stays up when the repository lists hide everything, so the checkbox that undoes it is reachable.
	let showListToolbar = $derived(!loading && !setupRequired && tabTotal > 0);
	let showTabToggle = $derived(!loading && !setupRequired);
	let askNotifications = $derived(!loading && !setupRequired && settings.notificationsEnabled === null);
	let searchActive = $derived(isSearchOpen || searchQuery.trim().length > 0);

	// The view decides which selections still mean something; this takes back what it applied and
	// hands it to the session, which is what puts filters on disk for the badge to read.
	$effect(() => {
		if (!sameFilters(activeFilters, view.filters)) {
			activeFilters = view.filters;
		}

		session.setFilters(view.filters);
	});
</script>

{#snippet card(pr: PullRequest)}
	<PrCard {pr} {isFullpageMode} {settings} {copiedItemId} onOpenUrl={safeOpenUrl} onCopy={handleCopy} />
{/snippet}

<div class={isFullpageMode ? 'min-h-screen px-6 py-6' : isSidebarMode ? 'popup-frame popup-frame-fill' : 'popup-frame'}>
	<div class={`mx-auto flex ${fullpageShellClasses} min-h-0 flex-col gap-3`}>
		<div class={`surface-card overflow-hidden ${isFullpageMode ? '' : 'flex h-full flex-col'}`}>
			<PopupHeader
				{provider}
				{isFullpageMode}
				refreshInProgress={syncing}
				showCompactIdentity={showSearchControls}
				{showTabToggle}
				{showSearchControls}
				{isSearchOpen}
				{searchActive}
				{filterActive}
				{currentTab}
				{myPrCount}
				{reviewCount}
				onOpenUrl={safeOpenUrl}
				onTabChange={handleTabChange}
				onToggleSearch={toggleSearch}
				onRefresh={refreshPrs}
				onOpenFullscreen={openFullscreen}
				onOpenSettings={openSettings}
			/>

			{#if askNotifications}
				<div class="flex items-center justify-between gap-3 border-b border-soft px-4 py-2.5">
					<p class="text-sm desc">Get notified when a PR needs you?</p>
					<div class="flex shrink-0 items-center gap-3 text-xs font-medium">
						<button class="text-(--accent) hover:underline" onclick={enableNotifications}>Enable</button>
						<button class="text-soft hover:underline" onclick={() => void session.setNotifications(false)}>Not now</button>
					</div>
				</div>
			{:else if justEnabled}
				<div class="border-b border-soft px-4 py-2.5">
					<NotificationTest />
				</div>
			{/if}

			{#if showListToolbar}
				<ListToolbar
					sortBy={settings.sortBy}
					hasRepoRules={hasRepoRules(settings)}
					repoFilterEnabled={settings.repoFilterEnabled}
					hiddenCount={repoHiddenCount}
					onRepoFilterChange={(repoFilterEnabled) => void session.updateSettings({ repoFilterEnabled })}
					onSortChange={(sortBy) => void session.updateSettings({ sortBy })}
				/>
			{/if}

			{#if showSearchControls && isSearchOpen}
				<div class="border-b border-soft px-2.5 py-1.5 sm:px-2.5">
					<SearchFilter
						embedded={true}
						fullpageMode={isFullpageMode}
						options={view.options}
						isToReviewTab={currentTab === 'toReview'}
						bind:query={searchQuery}
						bind:activeFilters={activeFilters}
						bind:isSearchOpen={isSearchOpen}
						bind:isFilterOpen={isFilterOpen}
					/>
				</div>
			{/if}

			<div class={`px-4 ${showSearchControls ? 'pb-3 pt-3' : 'py-3'} sm:px-4 ${isFullpageMode ? 'min-h-[70vh]' : 'min-h-0 flex-1 overflow-auto'}`}>
				{#if loading}
					<div class="flex min-h-50 items-center justify-center desc">Loading PRs...</div>
				{:else if !setupRequired && currentItems.length === 0 && repoHiddenCount > 0}
					<div class="py-8 text-center text-soft">
						<p>{repoHiddenCount === 1 ? 'The only PR here is' : `All ${repoHiddenCount} PRs here are`} hidden by your repository filter.</p>
						<button class="mt-2 text-sm text-(--accent) hover:underline" onclick={() => void session.updateSettings({ repoFilterEnabled: false })}>Show all repositories</button>
					</div>
				{:else if setupRequired || currentItems.length === 0}
					<PopupStates
						{setupRequired}
						{errorMessage}
						{currentTab}
						syncing={syncing && prData.lastFetched === null}
						onOpenSetup={openSetup}
						onRetry={() => session.reload()}
					/>
				{:else}
					{#if errorMessage}
						<div class="mb-4 rounded-lg border border-(--danger)/20 bg-(--danger)/10 p-3 text-sm text-(--danger) flex items-center justify-between gap-4">
							<span>{errorMessage}</span>
							<button class="shrink-0 text-xs font-medium underline hover:text-(--danger)/80 whitespace-nowrap" onclick={openSettings}>Open Settings</button>
						</div>
					{/if}
					{#if filteredItems.length === 0}
						<div class="py-8 text-center text-soft">
							<p>No PRs match your filters.</p>
							<button class="mt-2 text-sm text-(--accent) hover:underline" onclick={() => { searchQuery = ''; activeFilters = createDefaultFilters(); }}>Clear filters</button>
						</div>
					{:else if settings.groupByRepo}
						<div class="flex flex-col gap-4">
							{#each repoGroups as group (group.repo)}
								<section>
									<div class="mb-2 flex items-center gap-2 text-xs font-semibold text-soft">
										<FolderGit2 class="h-3.5 w-3.5 shrink-0" />
										<button class="unstyled-button min-w-0 truncate text-white hover:text-(--accent) hover:underline" title={group.repo} onclick={() => safeOpenUrl(`https://github.com/${encodeURI(group.repo)}`)}>{group.repo}</button>
										<span class="shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] leading-none">{group.items.length}</span>
										<span class="h-px flex-1 bg-(--border-soft)"></span>
									</div>
									<div class={cardListClasses}>
										{#each group.items as pr (pr.id)}
											{@render card(pr)}
										{/each}
									</div>
								</section>
							{/each}
						</div>
					{:else}
						<div class={cardListClasses}>
							{#each filteredItems as pr (pr.id)}
								{@render card(pr)}
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<div class="flex items-center justify-center gap-2 border-t border-soft px-4 py-2.5 text-xs text-soft sm:px-4">
				<span>{lastUpdatedText}</span>
				{#if newPrCount > 0}
					<span aria-hidden="true" class="text-dim">·</span>
					<span class="font-medium text-(--accent)">{newPrCount} new</span>
				{/if}
			</div>
		</div>

		{#if isFullpageMode}
			<AttributionFooter />
		{/if}

		{#if !isFullpageMode && !isSidebarMode}
			<PopupResizer defaultSize={defaultPopupSize()} onResize={rememberPopupSize} />
		{/if}

		{#if toastVisible}
			<div class={`fixed bottom-4 right-4 rounded-md border px-4 py-3 text-sm shadow-soft ${toastType === 'error' ? 'danger-surface text-(--danger)' : toastType === 'warning' ? 'warning-surface text-(--warning)' : 'accent-surface text-(--accent)'}`}>
				{toastMessage}
			</div>
		{/if}
	</div>
</div>
