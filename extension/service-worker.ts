import { GitHubProvider } from './lib/providers/github-provider';
import {
	actionOnClickedAddListener,
	actionOpenPopup,
	actionSetBadgeBackgroundColor,
	actionSetBadgeText,
	actionSetPopup,
	alarmsOnAlarmAddListener,
	alarmsClear,
	alarmsCreate,
	alarmsGet,
	commandsOnCommandAddListener,
	notificationsClear,
	notificationsCreate,
	notificationsOnButtonClickedAddListener,
	notificationsAvailable,
	notificationsOnClickedAddListener,
	permissionsOnAddedAddListener,
	popupIsOpen,
	POPUP_PATH,
	runtimeGetURL,
	runtimeOnInstalledAddListener,
	runtimeOnMessageAddListener,
	runtimeOnStartupAddListener,
	runtimeSendMessage,
	sidebarToggle,
	sidePanelSetOpenOnActionClick,
	tabsCreate,
	TOGGLE_COMMAND,
} from './lib/extension-api';
import { onFiltersChanged, storage } from './lib/storage';
import { badgeCount } from './lib/pr-view';
import { DASHBOARD_URL, notificationsFor } from './lib/pr-notify';
import { isAuthError } from './lib/errors';
import { createSyncCoordinator, runSync as runSyncWith, type SyncOptions } from './lib/sync';
import type { PrSource, PrSourceResult, PullRequestData, RuntimeMessage, Settings } from './lib/types';

const ALARM_NAME = 'pr-poll';

// No settings cache. MV3 tears this worker down between events, so a cache guards a local storage
// read that is already cheap, at the cost of three module-level variables five handlers had to
// invalidate by hand. Read on demand instead; storage is the single source.

async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const isNetworkError = error instanceof TypeError && error.message === 'Failed to fetch';
			if (!isNetworkError || attempt === maxRetries) {
				throw error;
			}
			const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
			console.log(`Fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	throw lastError;
}

interface FetchOptions {
	throwError?: boolean;
	/** Skip notifying when the cache is too old to diff: an overdue alarm, browser start, a dead token. */
	quietIfStale?: boolean;
}

const coordinator = createSyncCoordinator((options?: SyncOptions) => runSync(options));

async function fetchAndCachePRs({ throwError = false, quietIfStale = false }: FetchOptions = {}): Promise<void> {
	try {
		await coordinator.sync({ quietIfStale });
	} catch (error) {
		if (throwError) throw error;
	}
}

function runSync(options?: SyncOptions): Promise<void> {
	return runSyncWith({
		storage,
		makeSource: (provider) => new GitHubProvider({ token: provider.token, baseUrl: provider.baseUrl }),
		fetchWithRetry,
		refreshBadge,
		notify,
		...options,
	});
}

/** The count itself is decided by the view module, so the popup and the badge cannot disagree. */
async function refreshBadge(): Promise<void> {
	const { settings, pullRequests } = await storage.getBootstrapData();
	// A first sync's partial list is not a count worth showing.
	if (pullRequests.lastFetched === null) {
		await updateBadge(0);
		return;
	}
	const filters = await storage.getFilters(settings.pinnedTab);
	await updateBadge(badgeCount(pullRequests, settings, filters));
}

/**
 * What changed, said out loud. The decision itself lives in `pr-notify`, which is pure and testable;
 * this only checks that the user still wants to hear it and hands the specs to the OS.
 *
 * Filters are not consulted, by design — see the note at the top of `pr-notify.ts`.
 */
async function notify(source: PrSource, previous: PullRequestData, next: PrSourceResult): Promise<void> {
	try {
		const { settings, provider } = await storage.getBootstrapData();
		if (!settings.notificationsEnabled) {
			return;
		}

		// `search` can only say a PR left `state:open`, not how — look the vanished ids up to tell merged
		// from closed. A failed lookup just means vaguer wording, never lost notifications.
		const stillOpen = new Set(next.myPRs.map((pr) => pr.id));
		const vanishedIds = previous.myPRs.filter((pr) => !stillOpen.has(pr.id)).map((pr) => pr.id);
		const states =
			vanishedIds.length && source.getStates
				? await source.getStates(vanishedIds).catch((error) => {
						console.warn('Failed to look up closed PR states:', error);
						return new Map<string, string>();
					})
				: new Map<string, string>();

		for (const spec of notificationsFor(previous, next, provider?.user?.login || '', states, settings.groupNotifications)) {
			await notificationsCreate(spec.id, spec);
		}
	} catch (error) {
		// A refresh that fetched fine has already done its job; a notification failure must not undo it.
		console.error('Failed to send notifications:', error);
	}
}

/** The click target rides in the notification id, so an MV3 teardown between firing and clicking loses nothing. */
async function openFromNotificationId(id: string): Promise<void> {
	const url = id.slice(id.indexOf('|') + 1);
	console.log('Notification clicked:', id);
	await tabsCreate({ url: url === DASHBOARD_URL ? runtimeGetURL(DASHBOARD_URL) : url });
	await notificationsClear(id);
}

let notificationListenersRegistered = false;

/**
 * `notifications` is optional, so at worker load the namespace may not exist yet and both calls are
 * no-ops. Granting it from the popup fires `permissions.onAdded`, which is the only chance to wire
 * clicks up without waiting for the next worker start.
 */
function registerNotificationListeners(): void {
	// `permissions.onAdded` can fire for any optional permission, and re-adding here would leave two
	// listeners racing to open the same tab twice.
	if (notificationListenersRegistered || !notificationsAvailable()) {
		return;
	}
	notificationListenersRegistered = true;

	notificationsOnClickedAddListener(openFromNotificationId);

	notificationsOnButtonClickedAddListener((id, buttonIndex) => {
		// Button 1 is Dismiss. Clearing is the whole action.
		if (buttonIndex === 1) {
			return notificationsClear(id).then(() => undefined);
		}

		return openFromNotificationId(id);
	});
}

registerNotificationListeners();
permissionsOnAddedAddListener(registerNotificationListeners);

// Only so the shortcut can open a sidebar synchronously. Every display-mode change goes through
// `applyDisplayMode`, which refreshes it, and a worker restart re-runs that too.
let cachedDisplayMode: Settings['displayMode'] | undefined;

/**
 * Points the toolbar button at what the display mode says it opens. In sidebar mode the popup is
 * removed, because a button with a popup never reports its clicks. The browser forgets `setPopup`
 * when it restarts, so this runs on every worker start, not only when the setting changes.
 */
async function applyDisplayMode(): Promise<void> {
	const { displayMode } = await storage.getSettings();
	cachedDisplayMode = displayMode;
	const sidebar = displayMode === 'sidebar';
	await actionSetPopup(sidebar ? '' : runtimeGetURL(POPUP_PATH));
	// Never Chrome's own open-on-click: it would swallow the click that `sidebarToggle` needs.
	await sidePanelSetOpenOnActionClick(false);
}

void applyDisplayMode().catch((error) => console.error('Failed to apply display mode:', error));

// Only fires while the popup is removed, i.e. in sidebar mode.
actionOnClickedAddListener(sidebarToggle);

/**
 * Chrome's shortcut (`toggle-dashboard`) does what a toolbar click does, plus closing: the browser
 * swallows the key while the popup is open, so the popup cannot do it and `_execute_action` cannot be
 * used. Firefox keeps `_execute_action` and never reaches this.
 */
function toggleDashboard(windowId: number | undefined): void {
	switch (cachedDisplayMode) {
		case 'sidebar':
			// Synchronous on purpose: opening a sidebar needs the shortcut's user gesture.
			sidebarToggle(windowId);
			return;
		case 'fullpage':
			// What a toolbar click does here: the popup opens and redirects to this tab.
			void tabsCreate({ url: runtimeGetURL(DASHBOARD_URL) });
			return;
		case 'popup':
			void togglePopup().catch((error) => console.error('Failed to toggle popup:', error));
			return;
		default:
			// ponytail: cold worker, the mode is not cached yet. The settings read costs the gesture, so a
			// sidebar open here may need a second press. Popup and full page do not need one.
			void storage
				.getSettings()
				.then((settings) => {
					cachedDisplayMode = settings.displayMode;
					toggleDashboard(windowId);
				})
				.catch((error) => console.error('Failed to read display mode:', error));
	}
}

async function togglePopup(): Promise<void> {
	if (await popupIsOpen()) {
		await runtimeSendMessage({ type: 'CLOSE_POPUP' });
		return;
	}
	await actionOpenPopup();
}

commandsOnCommandAddListener((command, windowId) => {
	if (command === TOGGLE_COMMAND) toggleDashboard(windowId);
});

async function updateBadge(count: number): Promise<void> {
	const text = count > 0 ? String(count) : '';
	await Promise.all([actionSetBadgeText({ text }), actionSetBadgeBackgroundColor({ color: '#238636' })]);
}

async function setupPollingAlarm(forceRecreate = false): Promise<void> {
	const settings = await storage.getSettings();

	// Manual refresh mode — clear any existing alarm and stop
	if (!settings.pollingIntervalMs) {
		await alarmsClear(ALARM_NAME);
		console.log('Manual refresh mode: polling alarm cleared');
		return;
	}

	if (!forceRecreate) {
		const existing = await alarmsGet(ALARM_NAME);
		if (existing) {
			console.log('Polling alarm already exists, skipping recreation');
			return;
		}
	}

	const intervalMinutes = settings.pollingIntervalMs / 60000;
	await alarmsClear(ALARM_NAME);
	alarmsCreate(ALARM_NAME, {
		delayInMinutes: Math.max(1, intervalMinutes),
		periodInMinutes: Math.max(1, intervalMinutes),
	});
	console.log(`Polling alarm set for every ${intervalMinutes} minute(s)`);
}

runtimeOnInstalledAddListener(async (details) => {
	console.log('Extension installed/updated:', details.reason);
	if (details.reason === 'install') {
		const onboardingUrl = runtimeGetURL('onboarding/onboarding.html');
		await tabsCreate({ url: onboardingUrl });
		return;
	}

	await fetchAndCachePRs({ quietIfStale: true });
	await setupPollingAlarm(true);
});

runtimeOnStartupAddListener(async () => {
	await refreshBadge();
	await fetchAndCachePRs({ quietIfStale: true });
	await setupPollingAlarm(true);
});

// The popup writes its filters on every change, so watching the key keeps the badge in step with an
// open popup. One writer, one input — the popup no longer pushes a count of its own.
onFiltersChanged(() => {
	void refreshBadge();
});

alarmsOnAlarmAddListener(async (alarm) => {
	if (alarm.name === ALARM_NAME) {
		console.log('Polling alarm triggered');
		await fetchAndCachePRs({ quietIfStale: true });
	}
});

runtimeOnMessageAddListener(async (message) => {
	try {
		return await handleMessage(message as RuntimeMessage);
	} catch (error) {
		console.error('Error handling runtime message:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { success: false, error: errorMessage };
	}
});

const messageHandlers: Record<RuntimeMessage['type'], (message: RuntimeMessage) => Promise<unknown>> = {
	// Answers before the first fetch finishes: with many PRs that fetch takes tens of seconds, and both
	// onboarding and settings wait on this reply. The popup follows the fetch through `syncStatus`.
	// A sync already running was started with the previous token, so this one queues behind it rather
	// than joining it.
	PROVIDER_CONFIGURED: async () => {
		// A switched account's cache was just cleared, so the badge must not keep the old count meanwhile.
		await refreshBadge();
		await setupPollingAlarm(true);
		// Onboarding writes its display mode just before this message.
		await applyDisplayMode();
		void coordinator.syncAfterCurrent({ quietIfStale: true }).catch(() => undefined);
		return { success: true };
	},
	REFRESH_PRS: async () => {
		try {
			await fetchAndCachePRs({ throwError: true });
			return { success: true };
		} catch (error) {
			if (isAuthError(error)) {
				return { success: false, error: 'TOKEN_INVALID' };
			}
			return { success: false, error: (error as Error)?.message || 'Failed to refresh PRs' };
		}
	},
	GET_PRS: async () => storage.getPullRequests(),
	// The page that changed a setting has already written it. This says which keys moved so the worker
	// can react — it is not a second write, which is what the old UPDATE_SETTINGS/SETTINGS_UPDATED pair
	// ended up doing to the same value.
	SETTINGS_CHANGED: async (message) => {
		if ('settings' in message) {
			if ('displayMode' in message.settings) {
				await applyDisplayMode();
			}

			if ('pollingIntervalMs' in message.settings) {
				await setupPollingAlarm(true);
			}

			const badgeKeys = ['pinnedTab', 'badgeCountMode', 'repoFilterEnabled', 'repoInclude', 'repoExclude'];
			if (badgeKeys.some((key) => key in message.settings)) {
				await refreshBadge();
			}
		}
		return { success: true };
	},
	// Never handled here: it is addressed to the popup. Present because the table covers every type.
	CLOSE_POPUP: async () => ({ success: true }),
	CLEAR_ALL: async () => {
		await alarmsClear(ALARM_NAME);
		await actionSetBadgeText({ text: '' });
		// Storage is already empty, so this puts the popup back.
		await applyDisplayMode();
		return { success: true };
	},
};

// Test hatch. Paste `prPulseNotify()` into the service worker console to fire one through the real
// path — permission, icon, buttons and the click-to-open id are all exercised. The diff rules that
// decide *when* to fire are covered by pr-notify.test.ts instead; this only proves the plumbing.
Object.assign(globalThis, {
	prPulseNotify: (title = 'PR Pulse', message = 'Notifications are working') =>
		notificationsCreate(`test|${DASHBOARD_URL}`, { title, message, action: 'Open PR Pulse' }),
});

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
	const handler = messageHandlers[message.type];
	if (handler) {
		return handler(message);
	}

	console.warn('Unknown message type:', message.type);
	return { error: 'Unknown message type' };
}
