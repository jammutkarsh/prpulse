import assert from 'node:assert/strict';
import { createSyncCoordinator, runSync, type SyncDeps } from './sync';
import { createMemoryStore, createStorage } from './storage-core';
import type { PrSource, PrSourceResult, PullRequest } from './types';

// Run with: bun extension/lib/sync.test.ts

const pr = (id: string) => ({ id }) as unknown as PullRequest;
const result = (...ids: string[]): PrSourceResult => ({ myPRs: ids.map(pr), reviewRequests: [] });
const authError = Object.assign(new Error('Bad credentials'), { details: { statusCode: 401 } });

function setup(fetcher: (source: { token: string }, onProgress: Parameters<PrSource['getAllPullRequests']>[0]) => Promise<PrSourceResult>) {
	const store = createMemoryStore();
	const storage = createStorage(store);
	const calls = { badge: 0, notify: 0 };
	const deps: SyncDeps = {
		storage,
		makeSource: (provider) => ({ getAllPullRequests: (onProgress) => fetcher({ token: provider.token }, onProgress) }),
		fetchWithRetry: (fn) => fn(),
		refreshBadge: async () => void calls.badge++,
		notify: async () => void calls.notify++,
	};
	return { storage, store, deps, calls };
}

async function testFirstSyncWritesPartialsThenFinishes(): Promise<void> {
	const { storage, deps, calls } = setup(async (_s, onProgress) => {
		onProgress?.(result('1'), { loaded: 1, total: 2 });
		await new Promise((r) => setTimeout(r, 0));
		// Mid-sync the partial list is on disk but still reads as "no first sync yet".
		assert.equal((await storage.getPullRequests()).myPRs.length, 1);
		assert.equal((await storage.getPullRequests()).lastFetched, null);
		return result('1', '2');
	});
	await storage.setProvider({ type: 'github', token: 'a' });

	await runSync(deps);

	const data = await storage.getPullRequests();
	assert.equal(data.myPRs.length, 2);
	assert.notEqual(data.lastFetched, null);
	assert.equal((await storage.getBootstrapData()).syncStatus?.inProgress, false);
	assert.deepEqual(calls, { badge: 1, notify: 1 });
}

async function testLaterSyncKeepsLastCompleteList(): Promise<void> {
	const { storage, deps } = setup(async (_s, onProgress) => {
		onProgress?.(result('9'), { loaded: 1, total: 2 });
		await new Promise((r) => setTimeout(r, 0));
		assert.deepEqual(
			(await storage.getPullRequests()).myPRs.map((p) => p.id),
			['1'],
		);
		return result('1', '9');
	});
	await storage.setProvider({ type: 'github', token: 'a' });
	await storage.setPullRequests(result('1'));

	await runSync(deps);
	assert.equal((await storage.getPullRequests()).myPRs.length, 2);
}

async function testAuthErrorOnlyFlagsTheTokenThatFailed(): Promise<void> {
	const { storage, deps } = setup(async () => {
		// The user reconnects with a new token while this sync is still on the old one.
		await storage.setProvider({ type: 'github', token: 'new' });
		throw authError;
	});
	await storage.setProvider({ type: 'github', token: 'old' });

	await assert.rejects(runSync(deps));
	assert.equal((await storage.getProvider())?.isTokenInvalid ?? false, false);
}

async function testAuthErrorFlagsCurrentToken(): Promise<void> {
	const { storage, deps } = setup(async () => {
		throw authError;
	});
	await storage.setProvider({ type: 'github', token: 'a' });

	await assert.rejects(runSync(deps));
	assert.equal((await storage.getProvider())?.isTokenInvalid, true);
	assert.equal((await storage.getBootstrapData()).syncStatus?.inProgress, false);
}

async function testSuccessClearsInvalidFlag(): Promise<void> {
	const { storage, deps } = setup(async () => result('1'));
	await storage.setProvider({ type: 'github', token: 'a', isTokenInvalid: true });

	await runSync(deps);
	assert.equal((await storage.getProvider())?.isTokenInvalid, false);
}

async function testSuccessKeepsProviderChangesMadeMidSync(): Promise<void> {
	const { storage, deps } = setup(async () => {
		// Settings refreshes the token's expiry while this sync is running.
		await storage.setProvider({
			type: 'github',
			token: 'a',
			isTokenInvalid: true,
			user: { login: 'ada', tokenExpiration: 'later' },
		} as never);
		return result('1');
	});
	await storage.setProvider({
		type: 'github',
		token: 'a',
		isTokenInvalid: true,
		user: { login: 'ada', tokenExpiration: 'sooner' },
	} as never);

	await runSync(deps);
	const provider = await storage.getProvider();
	assert.equal(provider?.isTokenInvalid, false);
	assert.equal(provider?.user?.tokenExpiration, 'later');
}

async function testQuietIfStaleSkipsNotifyOnOldCache(): Promise<void> {
	const hoursAgo = Date.now() - 3 * 60 * 60 * 1000;
	for (const [lastFetched, quietIfStale, notified] of [
		[hoursAgo, true, 0],
		[hoursAgo, false, 1],
		[Date.now() - 60_000, true, 1],
	] as const) {
		const { storage, store, deps, calls } = setup(async () => result('1'));
		await storage.setProvider({ type: 'github', token: 'a' });
		await store.set({ pullRequests: { ...result('1'), lastFetched } });

		await runSync({ ...deps, quietIfStale });
		assert.equal(calls.notify, notified);
		assert.equal(calls.badge, 1);
		assert.notEqual((await storage.getPullRequests()).lastFetched, lastFetched);
	}
}

async function testResultDiscardedWhenProviderChanged(): Promise<void> {
	const { storage, deps, calls } = setup(async () => {
		await storage.setProvider({ type: 'github', token: 'new' });
		return result('1');
	});
	await storage.setProvider({ type: 'github', token: 'old' });

	await runSync(deps);
	assert.equal((await storage.getPullRequests()).lastFetched, null);
	assert.deepEqual(calls, { badge: 0, notify: 0 });
	assert.equal((await storage.getBootstrapData()).syncStatus?.inProgress, false);
}

async function testResultDiscardedWhenBaseUrlChanged(): Promise<void> {
	const { storage, deps, calls } = setup(async () => {
		await storage.setProvider({ type: 'github', token: 'a', baseUrl: 'https://ghe.example/api' });
		return result('1');
	});
	await storage.setProvider({ type: 'github', token: 'a', baseUrl: 'https://api.github.com' });

	await runSync(deps);
	assert.equal((await storage.getPullRequests()).lastFetched, null);
	assert.deepEqual(calls, { badge: 0, notify: 0 });
}

async function testFailedProgressWriteDoesNotFailTheSync(): Promise<void> {
	const { storage, deps } = setup(async (_s, onProgress) => {
		onProgress?.(result('1'), { loaded: 1, total: 1 });
		return result('1');
	});
	await storage.setProvider({ type: 'github', token: 'a' });
	const realPartial = storage.setPartialPullRequests;
	storage.setPartialPullRequests = async () => {
		throw new Error('QUOTA_BYTES exceeded');
	};

	await runSync(deps);
	storage.setPartialPullRequests = realPartial;
	assert.notEqual((await storage.getPullRequests()).lastFetched, null);
}

// A heartbeat that fires while a progress write is queued must not write the older counts over it.
async function testHeartbeatNeverRegressesProgress(): Promise<void> {
	const { storage, deps } = setup(async (_s, onProgress) => {
		onProgress?.(result('1'), { loaded: 40, total: 60 });
		await new Promise((r) => setTimeout(r, 40));
		const status = (await storage.getBootstrapData()).syncStatus;
		assert.equal(status?.loaded, 40);
		return result('1');
	});
	await storage.setProvider({ type: 'github', token: 'a' });

	await runSync({ ...deps, heartbeatMs: 1 });
}

// A reset mid-sync clears the provider; the finishing sync must not write its status back.
async function testResetMidSyncLeavesNoStatus(): Promise<void> {
	const { storage, store, deps } = setup(async (_s, onProgress) => {
		onProgress?.(result('1'), { loaded: 1, total: 2 });
		await new Promise((r) => setTimeout(r, 0));
		await storage.clearAll();
		return result('1');
	});
	await storage.setProvider({ type: 'github', token: 'a' });

	await runSync(deps);
	const left = await store.get(['syncStatus', 'pullRequests']);
	assert.equal(left.syncStatus, undefined);
	assert.equal(left.pullRequests, undefined);
}

async function testCoordinatorSharesAndQueues(): Promise<void> {
	const started: string[] = [];
	const release: Array<() => void> = [];
	const coordinator = createSyncCoordinator(
		(label: string) =>
			new Promise<void>((resolve, reject) => {
				started.push(label);
				release.push(() => (label === 'boom' ? reject(new Error('boom')) : resolve()));
			}),
	);

	// Concurrent callers share the one running sync.
	const first = coordinator.sync('poll');
	const joined = coordinator.sync('refresh');
	assert.equal(first, joined);
	assert.deepEqual(started, ['poll']);

	// A new token queues behind it instead of joining, and runs once the first settles.
	const queued = coordinator.syncAfterCurrent('connect');
	assert.deepEqual(started, ['poll']);
	release[0]!();
	await first;
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(started, ['poll', 'connect']);
	release[1]!();
	await queued;

	// A failed running sync still lets the queued one start.
	const failing = coordinator.sync('boom');
	const after = coordinator.syncAfterCurrent('retry');
	release[2]!();
	await assert.rejects(failing);
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(started, ['poll', 'connect', 'boom', 'retry']);
	release[3]!();
	await after;

	// Idle again: the next call starts a fresh sync.
	void coordinator.sync('later');
	assert.equal(started.at(-1), 'later');
}

async function testNoProviderThrows(): Promise<void> {
	const { deps } = setup(async () => result());
	await assert.rejects(runSync(deps), /No provider configured/);
}

async function testHeartbeatRefreshesStatus(): Promise<void> {
	const { storage, deps } = setup(async () => {
		await new Promise((r) => setTimeout(r, 40));
		const status = (await storage.getBootstrapData()).syncStatus;
		assert.equal(status?.inProgress, true);
		assert.ok((status?.updatedAt ?? 0) > status!.startedAt);
		return result('1');
	});
	await storage.setProvider({ type: 'github', token: 'a' });

	await runSync({ ...deps, heartbeatMs: 5 });
}

await testFirstSyncWritesPartialsThenFinishes();
await testLaterSyncKeepsLastCompleteList();
await testAuthErrorOnlyFlagsTheTokenThatFailed();
await testAuthErrorFlagsCurrentToken();
await testSuccessClearsInvalidFlag();
await testSuccessKeepsProviderChangesMadeMidSync();
await testQuietIfStaleSkipsNotifyOnOldCache();
await testResultDiscardedWhenProviderChanged();
await testResultDiscardedWhenBaseUrlChanged();
await testFailedProgressWriteDoesNotFailTheSync();
await testHeartbeatNeverRegressesProgress();
await testResetMidSyncLeavesNoStatus();
await testCoordinatorSharesAndQueues();
await testNoProviderThrows();
await testHeartbeatRefreshesStatus();
console.log('sync: all checks passed');
