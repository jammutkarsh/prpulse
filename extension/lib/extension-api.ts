import browser from 'webextension-polyfill';
import type { RuntimeMessage } from './types';

type CloneableValue = null | undefined | string | number | boolean | CloneableValue[] | { [key: string]: CloneableValue };
type AsyncLike<T> = T | Promise<T>;

const extensionBrowser = browser;

export type StorageChangeMap = Record<string, browser.Storage.StorageChange>;
export type StorageOnChangedListener = Parameters<typeof extensionBrowser.storage.onChanged.addListener>[0];
export type RuntimeOnInstalledListener = Parameters<typeof extensionBrowser.runtime.onInstalled.addListener>[0];
export type RuntimeOnStartupListener = Parameters<typeof extensionBrowser.runtime.onStartup.addListener>[0];
export type RuntimeOnMessageListener = (message: unknown, sender: browser.Runtime.MessageSender) => void | Promise<unknown>;
export type AlarmsOnAlarmListener = Parameters<typeof extensionBrowser.alarms.onAlarm.addListener>[0];
export type Unsubscribe = () => void;
export type OptionalPermission = browser.Manifest.OptionalPermission;

function toPlainData<T>(value: T): T {
	return normalizeCloneableValue(value, new WeakMap()) as T;
}

function normalizeObject(value: object, seen: WeakMap<object, unknown>): CloneableValue {
	if (seen.has(value)) {
		return seen.get(value) as CloneableValue;
	}

	const plainObject: Record<string, CloneableValue> = {};
	seen.set(value, plainObject);

	for (const [key, entry] of Object.entries(value)) {
		plainObject[key] = normalizeCloneableValue(entry, seen);
	}

	return plainObject;
}

function normalizeCloneableValue(value: unknown, seen: WeakMap<object, unknown>): CloneableValue {
	if (value == null) {
		return value as null | undefined;
	}

	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((entry) => normalizeCloneableValue(entry, seen));
	}

	if (typeof value !== 'object') {
		return JSON.parse(JSON.stringify(value)) as CloneableValue;
	}

	return normalizeObject(value, seen);
}

export function runtimeSendMessage<TResponse = unknown>(message: RuntimeMessage): Promise<TResponse> {
	return extensionBrowser.runtime.sendMessage(toPlainData(message)) as Promise<TResponse>;
}

export function runtimeGetURL(path: string): string {
	return extensionBrowser.runtime.getURL(path);
}

export function tabsCreate(createProperties: browser.Tabs.CreateCreatePropertiesType): Promise<browser.Tabs.Tab> {
	return extensionBrowser.tabs.create(createProperties);
}

export { POPUP_PATH, SIDEBAR_PATH } from './dashboard-paths';

/** An empty string removes the popup, which is what makes `action.onClicked` fire instead. */
export function actionSetPopup(popup: string): Promise<void> {
	return extensionBrowser.action.setPopup({ popup });
}

/**
 * Deliberately not wrapped like the other listeners: opening a sidebar is only allowed inside the
 * click's user gesture, so the listener has to run synchronously with nothing awaited in front of it.
 * The keyboard shortcut (`_execute_action`) arrives here too, as if the button had been clicked.
 */
export function actionOnClickedAddListener(listener: (windowId: number | undefined) => void): void {
	extensionBrowser.action.onClicked.addListener((tab) => listener(tab?.windowId));
}

/** The parts of Chrome's API used here that the polyfill's types do not cover. */
interface ChromeSidePanelApi {
	sidePanel?: {
		setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
		open(options: { windowId: number }): Promise<void>;
		/** Chrome 141+. */
		close?(options: { windowId: number }): Promise<void>;
	};
	runtime?: {
		getContexts(filter: { contextTypes: string[] }): Promise<Array<{ windowId: number }>>;
	};
}

function chromeApi(): ChromeSidePanelApi | undefined {
	return (globalThis as { chrome?: ChromeSidePanelApi }).chrome;
}

/**
 * Opens the sidebar in this window, or closes it if it is already open. Must be called synchronously
 * from a click or shortcut handler: both browsers refuse to open a sidebar outside a user gesture.
 *
 * Firefox has a toggle. Chrome has only open and close and no way to ask synchronously which is
 * needed, so the question is asked first and `open` is sent right behind it without waiting: the
 * answer describes the moment before the open, and an open on a panel that was already showing does
 * nothing. If the answer says it was showing, it is closed.
 */
export function sidebarToggle(windowId: number | undefined): void {
	const sidebarAction = (extensionBrowser as unknown as { sidebarAction?: { toggle(): Promise<void> } }).sidebarAction;
	if (sidebarAction) {
		void sidebarAction.toggle().catch((error) => logExtensionApiError('sidebarAction.toggle', error));
		return;
	}

	const chrome = chromeApi();
	const sidePanel = chrome?.sidePanel;
	if (!sidePanel || windowId === undefined) return;

	const openBefore = chrome.runtime?.getContexts({ contextTypes: ['SIDE_PANEL'] }) ?? Promise.resolve([]);
	const opened = sidePanel.open({ windowId });

	void Promise.all([openBefore, opened])
		.then(([contexts]) => {
			if (contexts.some((context) => context.windowId === windowId)) {
				return sidePanel.close?.({ windowId });
			}
		})
		.catch((error) => logExtensionApiError('sidePanel toggle', error));
}

/**
 * Chrome can open the side panel on toolbar clicks by itself, but then the click never reaches the
 * extension. It is kept switched off so clicks and the shortcut both go through `sidebarToggle`.
 * Absent in Firefox, and outside the polyfill, hence the raw `chrome` global.
 */
export async function sidePanelSetOpenOnActionClick(open: boolean): Promise<void> {
	await chromeApi()?.sidePanel?.setPanelBehavior({ openPanelOnActionClick: open });
}

/** Where each browser lets the user rebind an extension's shortcuts. Neither page can be linked to. */
export const SHORTCUTS_PAGE_HINT =
	__BROWSER_TARGET__ === 'firefox'
		? 'about:addons, then the gear menu, then Manage Extension Shortcuts'
		: 'chrome://extensions/shortcuts';

/** The key currently bound to the toolbar button, or an empty string when the user or a clash left it unset. */
export async function actionShortcut(): Promise<string> {
	try {
		const commands = await extensionBrowser.commands.getAll();
		return commands.find((command) => command.name === '_execute_action')?.shortcut || '';
	} catch (error) {
		logExtensionApiError('commands.getAll', error);
		return '';
	}
}

export function actionSetBadgeText(details: browser.Action.SetBadgeTextDetailsType): Promise<void> {
	return extensionBrowser.action.setBadgeText(details);
}

export function actionSetBadgeBackgroundColor(details: browser.Action.SetBadgeBackgroundColorDetailsType): Promise<void> {
	return extensionBrowser.action.setBadgeBackgroundColor(details);
}

export function storageLocalGet<T = unknown>(keys: string[]): Promise<Record<string, T>> {
	return extensionBrowser.storage.local.get(keys) as Promise<Record<string, T>>;
}

export function storageLocalSet(items: Record<string, unknown>): Promise<void> {
	return extensionBrowser.storage.local.set(toPlainData(items));
}

export function storageLocalRemove(keys: string[]): Promise<void> {
	return extensionBrowser.storage.local.remove(keys);
}

export function storageLocalClear(): Promise<void> {
	return extensionBrowser.storage.local.clear();
}

/** What to call the browser when telling someone to go unmute it in their OS settings. */
export const BROWSER_LABEL = __BROWSER_TARGET__ === 'firefox' ? 'Firefox' : 'Chrome';

export interface NotificationContent {
	title: string;
	message: string;
	/** Button 0's label. Button 1 is always Dismiss. Chrome only — Firefox draws no buttons. */
	action: string;
	/** A dimmed third line, Chrome only. Dropped on Firefox rather than folded into the message. */
	detail?: string;
}

/**
 * `buttons` and `requireInteraction` are Chrome-only, and Firefox's schema validation *rejects* an
 * unknown property rather than ignoring it — so the options object is built per target rather than
 * passed through and hoped for.
 */
export function notificationsCreate(id: string, content: NotificationContent): Promise<string> {
	const options = {
		type: 'basic' as const,
		iconUrl: runtimeGetURL('icons/icon128.png'),
		title: content.title,
		message: content.message,
	};

	if (__BROWSER_TARGET__ === 'firefox') {
		return extensionBrowser.notifications.create(id, options);
	}

	return extensionBrowser.notifications.create(id, {
		...options,
		...(content.detail ? { contextMessage: content.detail } : {}),
		buttons: [{ title: content.action }, { title: 'Dismiss' }],
		requireInteraction: true,
	} as browser.Notifications.CreateNotificationOptions);
}

export function notificationsClear(id: string): Promise<boolean> {
	return extensionBrowser.notifications.clear(id);
}

/** Whether the optional `notifications` permission has been granted in this worker's lifetime. */
export function notificationsAvailable(): boolean {
	return Boolean(extensionBrowser.notifications?.onClicked);
}

/**
 * `notifications` is optional, so the whole namespace is undefined until it is granted — reading
 * `.onClicked` off it would throw at worker load and take every other listener down with it. Same
 * guard covers Firefox, which has no `onButtonClicked` at all.
 */
export function notificationsOnClickedAddListener(listener: (notificationId: string) => void): void {
	extensionBrowser.notifications?.onClicked?.addListener(wrapListener('notifications.onClicked', listener));
}

export function notificationsOnButtonClickedAddListener(listener: (notificationId: string, buttonIndex: number) => void): void {
	extensionBrowser.notifications?.onButtonClicked?.addListener(wrapListener('notifications.onButtonClicked', listener));
}

export function permissionsContains(permissions: OptionalPermission[]): Promise<boolean> {
	return extensionBrowser.permissions.contains({ permissions });
}

/**
 * Must be called straight out of a click handler: both browsers reject a request that has lost the
 * user gesture, and awaiting anything first is enough to lose it.
 */
export function permissionsRequest(permissions: OptionalPermission[]): Promise<boolean> {
	return extensionBrowser.permissions.request({ permissions });
}

export function permissionsOnAddedAddListener(listener: () => void): void {
	extensionBrowser.permissions.onAdded.addListener(wrapListener('permissions.onAdded', listener));
}

export function alarmsGet(name: string): Promise<browser.Alarms.Alarm | undefined> {
	return extensionBrowser.alarms.get(name);
}

export function alarmsCreate(name: string, alarmInfo: browser.Alarms.CreateAlarmInfoType): void {
	extensionBrowser.alarms.create(name, alarmInfo);
}

export function alarmsClear(name: string): Promise<boolean> {
	return extensionBrowser.alarms.clear(name);
}

function logExtensionApiError(context: string, error: unknown): void {
	console.error(`Extension API error in ${context}:`, error);
}

function wrapListener<TArgs extends unknown[], TResult>(context: string, listener: (...args: TArgs) => AsyncLike<TResult>) {
	return (...args: TArgs): AsyncLike<TResult> => {
		try {
			const result = listener(...args);
			if (result instanceof Promise) {
				return result.catch((error) => {
					logExtensionApiError(context, error);
					throw error;
				}) as Promise<TResult>;
			}

			return result;
		} catch (error) {
			logExtensionApiError(context, error);
			throw error;
		}
	};
}

/** Callers unsubscribe with the returned handle, so nobody has to hold on to the listener itself. */
export function storageOnChangedAddListener(listener: StorageOnChangedListener): Unsubscribe {
	extensionBrowser.storage.onChanged.addListener(listener);
	return () => extensionBrowser.storage.onChanged.removeListener(listener);
}

export function runtimeOnInstalledAddListener(listener: RuntimeOnInstalledListener): void {
	extensionBrowser.runtime.onInstalled.addListener(wrapListener('runtime.onInstalled', listener));
}

export function runtimeOnStartupAddListener(listener: RuntimeOnStartupListener): void {
	extensionBrowser.runtime.onStartup.addListener(wrapListener('runtime.onStartup', listener));
}

export function runtimeOnMessageAddListener(listener: RuntimeOnMessageListener): void {
	extensionBrowser.runtime.onMessage.addListener(wrapListener('runtime.onMessage', listener));
}

export function alarmsOnAlarmAddListener(listener: AlarmsOnAlarmListener): void {
	extensionBrowser.alarms.onAlarm.addListener(wrapListener('alarms.onAlarm', listener));
}
