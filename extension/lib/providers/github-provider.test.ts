import assert from 'node:assert/strict';
import { ProviderError } from '../errors';
import {
	buildReviews,
	buildBehindQuery,
	firstUnresolvedThreadUrl,
	GitHubProvider,
	isQueryTimeout,
	nextPageSize,
	readBehindCounts,
	smallerPageSize,
} from './github-provider';

// Sizing the request to the count probe is what keeps a 7-PR user from being billed like a 100-PR one,
// so the arithmetic gets a check. Run with: bun run test
function testNextPageSize(): void {
	// Small view: one page sized exactly, no rounding up to the max.
	assert.equal(nextPageSize(7, 0), 7);

	// Empty view still floors at 1 — GraphQL rejects `first: 0`. Callers skip the request entirely.
	assert.equal(nextPageSize(0, 0), 1);

	// Large view: clamped to GitHub's per-page maximum.
	assert.equal(nextPageSize(250, 0), 100);

	// Later pages ask only for the remainder, so the last page of 250 costs half a full page.
	assert.equal(nextPageSize(250, 100), 100);
	assert.equal(nextPageSize(250, 200), 50);

	// Drift: PRs closed between the probe and the fetch can push seen past the count. Still never 0.
	assert.equal(nextPageSize(10, 12), 1);
}

testNextPageSize();

// The "Changes Requested (N)" link must land on a thread the count actually includes — resolved and
// outdated threads must never win, even when they come first. Run with: bun run test
function testFirstUnresolvedThreadUrl(): void {
	const resolved = { isResolved: true, isOutdated: false, comments: { nodes: [{ url: 'resolved', createdAt: '2026-01-01T00:00:00Z' }] } };
	const outdated = { isResolved: false, isOutdated: true, comments: { nodes: [{ url: 'outdated', createdAt: '2026-01-02T00:00:00Z' }] } };
	const open = { isResolved: false, isOutdated: false, comments: { nodes: [{ url: 'open', createdAt: '2026-01-03T00:00:00Z' }] } };

	// Resolved and outdated threads are skipped even when listed before the open one.
	assert.equal(firstUnresolvedThreadUrl([resolved, outdated, open]), 'open');

	// No open thread: nothing to link to.
	assert.equal(firstUnresolvedThreadUrl([resolved, outdated]), undefined);

	// GitHub's array order isn't chronological: the later-created open thread appears first in the
	// array, but the earlier-created one must still win.
	const openLater = { isResolved: false, isOutdated: false, comments: { nodes: [{ url: 'later', createdAt: '2026-01-05T00:00:00Z' }] } };
	const openEarlier = {
		isResolved: false,
		isOutdated: false,
		comments: { nodes: [{ url: 'earlier', createdAt: '2026-01-04T00:00:00Z' }] },
	};
	assert.equal(firstUnresolvedThreadUrl([openLater, openEarlier]), 'earlier');

	// Empty thread list.
	assert.equal(firstUnresolvedThreadUrl([]), undefined);
}

testFirstUnresolvedThreadUrl();

// GitHub's GraphQL timeout surfaces as 502/504. Only those may shrink the page; anything else is a
// real failure and must still throw. Run with: bun run test
function testTimeoutShrinking(): void {
	const error = (statusCode: number) => new ProviderError('GitHub API error', 'API_ERROR', { statusCode });

	assert.equal(isQueryTimeout(error(502)), true);
	assert.equal(isQueryTimeout(error(504)), true);
	assert.equal(isQueryTimeout(error(500)), false);
	assert.equal(isQueryTimeout(error(401)), false);
	assert.equal(isQueryTimeout(new TypeError('Failed to fetch')), false);

	// Halves, floors at the minimum, then gives up.
	assert.equal(smallerPageSize(100), 50);
	assert.equal(smallerPageSize(50), 25);
	assert.equal(smallerPageSize(25), 12);
	assert.equal(smallerPageSize(12), 10);
	assert.equal(smallerPageSize(10), null);
	assert.equal(smallerPageSize(7), null);
}

testTimeoutShrinking();

/**
 * A fake GraphQL endpoint holding `total` open PRs that times out (502) on any search page larger
 * than `maxFirst`, which is how GitHub behaves for an account with many open PRs.
 */
function fakeGitHub(total: number, maxFirst: number, status = 502) {
	const searchSizes: number[] = [];

	const fetchStub = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const { query, variables } = JSON.parse(String(init?.body));
		const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

		if (query.includes('issueCount')) {
			return json({
				data: { rateLimit: null, myPRs: { issueCount: total }, reviewRequests: { issueCount: 0 }, reviewedPRs: { issueCount: 0 } },
			});
		}

		searchSizes.push(variables.first);
		if (variables.first > maxFirst) {
			return new Response('', { status });
		}

		const start = variables.after ? Number(variables.after) : 0;
		const end = Math.min(start + variables.first, total);
		const nodes = Array.from({ length: end - start }, (_, i) => ({
			id: `PR_${start + i}`,
			number: start + i,
			title: 't',
			url: 'https://github.com/o/r/pull/1',
		}));
		return json({ data: { rateLimit: null, search: { pageInfo: { hasNextPage: end < total, endCursor: String(end) }, nodes } } });
	};

	return { fetchStub, searchSizes };
}

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
	const original = globalThis.fetch;
	const originalWarn = console.warn;
	globalThis.fetch = stub;
	console.warn = () => {};
	try {
		return await run();
	} finally {
		globalThis.fetch = original;
		console.warn = originalWarn;
	}
}

async function testFetchSurvivesQueryTimeouts(): Promise<void> {
	// 155 open PRs, and the default 25-PR page never times out: no retries at all.
	const healthy = fakeGitHub(155, 25);
	const fetched = await withFetch(healthy.fetchStub as typeof fetch, () => new GitHubProvider({ token: 't' }).getAllPullRequests());
	assert.equal(fetched.myPRs.length, 155);
	assert.deepEqual(healthy.searchSizes, [25, 25, 25, 25, 25, 25, 5]);

	// Anything above 12 per page times out. All 155 must still load, and once shrunk the view stays
	// shrunk rather than timing out again on every page.
	const busy = fakeGitHub(155, 12);
	const result = await withFetch(busy.fetchStub as typeof fetch, () => new GitHubProvider({ token: 't' }).getAllPullRequests());
	assert.equal(result.myPRs.length, 155);
	assert.equal(new Set(result.myPRs.map((pr) => pr.id)).size, 155);
	assert.deepEqual(busy.searchSizes, [25, ...Array(12).fill(12), 11]);

	// 504 is treated the same way.
	const gateway = fakeGitHub(30, 12, 504);
	const viaGateway = await withFetch(gateway.fetchStub as typeof fetch, () => new GitHubProvider({ token: 't' }).getAllPullRequests());
	assert.equal(viaGateway.myPRs.length, 30);
	assert.deepEqual(gateway.searchSizes, [25, 12, 12, 6]);

	// Still timing out at the floor: give up and surface the error rather than retrying forever.
	const hopeless = fakeGitHub(155, 5);
	await assert.rejects(
		withFetch(hopeless.fetchStub as typeof fetch, () => new GitHubProvider({ token: 't' }).getAllPullRequests()),
		(error: unknown) => isQueryTimeout(error),
	);
	assert.deepEqual(hopeless.searchSizes, [25, 12, 10]);

	// The 300-PR cap still applies when pages are small.
	const huge = fakeGitHub(1000, 25);
	const capped = await withFetch(huge.fetchStub as typeof fetch, () => new GitHubProvider({ token: 't' }).getAllPullRequests());
	assert.equal(capped.myPRs.length, 300);
}

// Every page reports everything fetched so far, so the popup can show a slow first sync as it lands.
async function testProgressReportsEveryPage(): Promise<void> {
	const github = fakeGitHub(60, 25);
	const reports: Array<{ myPRs: number; loaded: number; total: number }> = [];
	const result = await withFetch(github.fetchStub as typeof fetch, () =>
		new GitHubProvider({ token: 't' }).getAllPullRequests((partial, progress) => {
			reports.push({ myPRs: partial.myPRs.length, ...progress });
		}),
	);

	assert.deepEqual(reports, [
		{ myPRs: 25, loaded: 25, total: 60 },
		{ myPRs: 50, loaded: 50, total: 60 },
		{ myPRs: 60, loaded: 60, total: 60 },
	]);
	assert.equal(result.myPRs.length, 60);
}

await testFetchSurvivesQueryTimeouts();
// Review status, modelled on a real PR: a code-quality bot approved it four times, a team's review was
// still requested, and GitHub said REVIEW_REQUIRED. It used to read as approved. Run with: bun run test
function testReviewStatus(): void {
	type ReviewInput = Parameters<typeof buildReviews>[0];
	const review = (login: string, state: string, typename = 'User') => ({
		databaseId: 1,
		state,
		author: { login, avatarUrl: '', __typename: typename },
	});
	const pr = (overrides: Partial<ReviewInput>): ReviewInput =>
		({ reviews: { nodes: [] }, reviewRequests: { nodes: [] }, reviewThreads: { nodes: [] }, ...overrides }) as ReviewInput;

	const botApprovals = { nodes: [review('codescene-access', 'APPROVED', 'Bot'), review('codescene-access', 'APPROVED', 'Bot')] };
	const teamRequest = { nodes: [{ requestedReviewer: { __typename: 'Team' } }] };

	// GitHub's own decision wins, whatever the reviews look like.
	assert.equal(
		buildReviews(pr({ reviews: botApprovals, reviewRequests: teamRequest, reviewDecision: 'REVIEW_REQUIRED' })).status,
		'pending',
	);
	assert.equal(buildReviews(pr({ reviews: botApprovals, reviewDecision: 'APPROVED' })).status, 'approved');
	assert.equal(buildReviews(pr({ reviewDecision: 'CHANGES_REQUESTED' })).status, 'changes_requested');

	// An outstanding request holds GitHub's APPROVED back to pending, so it stays in that reviewer's list.
	const userRequest = { nodes: [{ requestedReviewer: { __typename: 'User', login: 'ada' } }] };
	assert.equal(buildReviews(pr({ reviewRequests: userRequest, reviewDecision: 'APPROVED' })).status, 'pending');
	assert.equal(buildReviews(pr({ reviewRequests: teamRequest, reviewDecision: 'APPROVED' })).status, 'pending');

	// No decision (no review required): bots don't count as reviewers, and a team request is still pending.
	const botsOnly = buildReviews(pr({ reviews: botApprovals, reviewDecision: null }));
	assert.equal(botsOnly.status, 'pending');
	assert.deepEqual(botsOnly.reviewers, []);
	assert.equal(buildReviews(pr({ reviews: { nodes: [review('ada', 'APPROVED')] }, reviewRequests: teamRequest })).status, 'pending');

	// A person's approval with nothing outstanding still reads as approved.
	assert.equal(
		buildReviews(pr({ reviews: { nodes: [review('ada', 'APPROVED'), review('bot', 'APPROVED', 'Bot')] } })).status,
		'approved',
	);

	// An unrecognised decision falls back to the local reading.
	assert.equal(buildReviews(pr({ reviews: { nodes: [review('ada', 'APPROVED')] }, reviewDecision: 'SOMETHING_NEW' })).status, 'approved');

	// A GitHub-reported CHANGES_REQUESTED still yields the deep-link fields, skipping bot reviews.
	const changes = buildReviews(
		pr({
			reviews: {
				nodes: [
					{ ...review('ada', 'CHANGES_REQUESTED'), databaseId: 7 },
					{ ...review('bot', 'CHANGES_REQUESTED', 'Bot'), databaseId: 9 },
				],
			},
			reviewThreads: {
				nodes: [{ isResolved: false, isOutdated: false, comments: { nodes: [{ url: 'u1', createdAt: '2024-01-01T00:00:00Z' }] } }],
			},
			reviewDecision: 'CHANGES_REQUESTED',
		}),
	);
	assert.equal(changes.changesRequestedReviewId, 7);
	assert.equal(changes.openThreadCount, 1);
	assert.equal(changes.firstUnresolvedThreadUrl, 'u1');

	// Team requests stay out of `pendingReviewers`, which notifications match against the viewer's login.
	const mixed = { nodes: [{ requestedReviewer: { __typename: 'User', login: 'ada' } }, { requestedReviewer: { __typename: 'Team' } }] };
	assert.deepEqual(buildReviews(pr({ reviewRequests: mixed })).pendingReviewers, ['ada']);
}

testReviewStatus();
function testBehindCounts(): void {
	const targets = [
		{ id: 'github-A', owner: 'o', name: 'r', base: 'main', headOid: 'abc' },
		{ id: 'github-B', owner: 'o2', name: 'r2', base: 'dev', headOid: 'def' },
	];
	const { query, variables } = buildBehindQuery(targets);
	assert.match(query, /p0: repository\(owner: \$o0, name: \$n0\)/);
	assert.match(query, /p1: repository/);
	assert.deepEqual(variables, { o0: 'o', n0: 'r', b0: 'main', h0: 'abc', o1: 'o2', n1: 'r2', b1: 'dev', h1: 'def' });

	// Unreadable repo, missing base ref and failed compare all leave the count off rather than showing 0.
	const counts = readBehindCounts(targets, { rateLimit: null, p0: { ref: { compare: { behindBy: 0 } } }, p1: { ref: null } });
	assert.equal(counts.get('github-A'), 0);
	assert.equal(counts.has('github-B'), false);
}

testBehindCounts();
await testProgressReportsEveryPage();
console.log('github-provider: all checks passed');
