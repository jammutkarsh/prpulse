import assert from 'node:assert/strict';
import { applyRepoFilter, hasRepoRules, isValidRepoPattern, matchesRepoPattern, parseRepoPatterns } from './repo-filter';

// The include/exclude lists decide what the whole dashboard is about. Run with: npm test

function testGlobs(): void {
	assert.equal(matchesRepoPattern('acme/api', 'acme/api'), true);
	assert.equal(matchesRepoPattern('acme/api', 'acme/*'), true);
	assert.equal(matchesRepoPattern('acme/api', '*/api'), true);
	assert.equal(matchesRepoPattern('acme/api', '*/*'), true);
	assert.equal(matchesRepoPattern('acme/api', 'acme/web'), false);
	assert.equal(matchesRepoPattern('acme-labs/api', 'acme/*'), false);

	assert.equal(matchesRepoPattern('foo-team/bar-service', 'foo-*/bar-*'), true);
	assert.equal(matchesRepoPattern('foo-team/baz-service', 'foo-*/bar-*'), false);
	assert.equal(matchesRepoPattern('xfoo-team/bar-service', 'foo-*/bar-*'), false);
	assert.equal(matchesRepoPattern('acme/my-api-v2', '*/*api*'), true);

	// A bare name is an owner.
	assert.equal(matchesRepoPattern('acme/api', 'acme'), true);
	assert.equal(matchesRepoPattern('acme/api', 'ac*'), true);
	assert.equal(matchesRepoPattern('other/acme', 'acme'), false);

	// Case-insensitive like GitHub; everything but `*` is literal, the dot included.
	assert.equal(matchesRepoPattern('Acme/API', 'acme/api'), true);
	assert.equal(matchesRepoPattern('acme/apixjs', 'acme/api.js'), false);
	assert.equal(matchesRepoPattern('acme/api.js', 'acme/api.js'), true);

	// Not patterns at all: these match nothing rather than something surprising.
	assert.equal(matchesRepoPattern('acme/api', ''), false);
	assert.equal(matchesRepoPattern('acme/api', 'acme/api/extra'), false);
	assert.equal(matchesRepoPattern('acme/api', 'acme/(api|web)'), false);
}

// Every extra `*` multiplies the matcher's backtracking, so a name may only hold a few.
function testWildcardLimit(): void {
	assert.equal(isValidRepoPattern('*a*b*/*c*d*'), true);
	assert.equal(isValidRepoPattern('acme/*a*a*a*c'), false);
	assert.equal(matchesRepoPattern('acme/aaac', 'acme/*a*a*a*c'), false);
	assert.deepEqual(parseRepoPatterns('acme/*a*a*a*c acme/*').invalid, ['acme/*a*a*a*c']);

	// A run of stars is one wildcard, both for the limit and for the match.
	assert.equal(isValidRepoPattern('acme/****api****'), true);
	assert.equal(matchesRepoPattern('acme/my-api-v2', 'acme/**api**'), true);
	assert.equal(matchesRepoPattern('acme/x/api', 'acme/**api'), false);

	// The worst pattern still allowed, against a name that makes it try everything.
	const started = performance.now();
	assert.equal(matchesRepoPattern(`${'a'.repeat(100)}/${'a'.repeat(100)}`, '*a*a*c/*a*a*c'), false);
	assert.ok(performance.now() - started < 100);
}

function testParse(): void {
	assert.deepEqual(parseRepoPatterns('acme/*\n  foo-*/bar-* , solo\n\nacme/*'), {
		patterns: ['acme/*', 'foo-*/bar-*', 'solo'],
		invalid: [],
	});
	assert.deepEqual(parseRepoPatterns('acme/* a/b/c https://github.com/acme/api'), {
		patterns: ['acme/*'],
		invalid: ['a/b/c', 'https://github.com/acme/api'],
	});
	assert.deepEqual(parseRepoPatterns('   '), { patterns: [], invalid: [] });
}

function testApply(): void {
	const items = ['acme/api', 'acme/web', 'acme/legacy-api', 'globex/web', 'me/dotfiles'].map((repoFullName) => ({ repoFullName }));
	const names = (settings: Parameters<typeof applyRepoFilter>[1]) => applyRepoFilter(items, settings).map((item) => item.repoFullName);
	const on = { repoFilterEnabled: true, repoInclude: [] as string[], repoExclude: [] as string[] };

	// No rules: nothing is filtered, and the same array comes back.
	assert.equal(applyRepoFilter(items, on), items);
	assert.equal(hasRepoRules(on), false);

	assert.deepEqual(names({ ...on, repoInclude: ['acme/*'] }), ['acme/api', 'acme/web', 'acme/legacy-api']);
	assert.deepEqual(names({ ...on, repoExclude: ['*/web'] }), ['acme/api', 'acme/legacy-api', 'me/dotfiles']);

	// Include, then exclude: the exclude wins over a repo the include let in.
	assert.deepEqual(names({ ...on, repoInclude: ['acme', 'globex/*'], repoExclude: ['acme/legacy-*'] }), [
		'acme/api',
		'acme/web',
		'globex/web',
	]);
	assert.deepEqual(names({ ...on, repoInclude: ['acme/api'], repoExclude: ['acme/*'] }), []);

	// Switched off from the list: rules stay configured but do nothing.
	const off = { repoFilterEnabled: false, repoInclude: ['acme/*'], repoExclude: ['*/web'] };
	assert.equal(applyRepoFilter(items, off), items);
	assert.equal(hasRepoRules(off), true);

	// An unusable stored entry is ignored, not treated as "include nothing".
	assert.equal(hasRepoRules({ repoInclude: ['a/b/c'], repoExclude: [] }), false);
	assert.equal(applyRepoFilter(items, { ...on, repoInclude: ['a/b/c'] }), items);
}

testGlobs();
testWildcardLimit();
testParse();
testApply();
console.log('repo-filter: all checks passed');
