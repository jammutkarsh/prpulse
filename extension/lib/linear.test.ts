import assert from 'node:assert/strict';
import { issueLinkFor } from './issue-tracker';
import { commitLinearWorkspace, linearDashboardUrlFor, linearLinkFor, sanitizeLinearWorkspace } from './linear';

// Same trust boundary as jira.test.ts: user text in, an href out. Run with: npm test

function testWorkspaceAcceptsSlugOrPastedLink(): void {
	assert.equal(sanitizeLinearWorkspace('acme'), 'acme');
	assert.equal(sanitizeLinearWorkspace('  Acme-Corp  '), 'acme-corp');
	assert.equal(sanitizeLinearWorkspace('linear.app/acme'), 'acme');
	assert.equal(sanitizeLinearWorkspace('https://linear.app/acme/issue/ENG-12/some-title?x=1#y'), 'acme');
	assert.equal(sanitizeLinearWorkspace('https://linear.app/acme/team/ENG/active'), 'acme');
}

function testWorkspaceRejectsEverythingElse(): void {
	assert.equal(sanitizeLinearWorkspace(''), '');
	assert.equal(sanitizeLinearWorkspace('   '), '');
	assert.equal(sanitizeLinearWorkspace('https://linear.app'), '');
	// Only Linear's own host: a slug lifted from another site would build a link to the wrong workspace.
	assert.equal(sanitizeLinearWorkspace('https://evil.example/acme'), '');
	assert.equal(sanitizeLinearWorkspace('https://linear.app.evil.example/acme'), '');
	assert.equal(sanitizeLinearWorkspace('javascript:alert(1)'), '');
	assert.equal(sanitizeLinearWorkspace('ftp://linear.app/acme'), '');
	assert.equal(sanitizeLinearWorkspace('acme/../x'), '');
	assert.equal(sanitizeLinearWorkspace('ac me'), '');
}

function testCommit(): void {
	assert.equal(commitLinearWorkspace(''), '');
	assert.equal(commitLinearWorkspace('  '), '');
	assert.equal(commitLinearWorkspace('https://linear.app/acme/issue/ENG-1'), 'acme');
	assert.equal(commitLinearWorkspace('not a workspace'), null);
}

function testLinks(): void {
	assert.deepEqual(linearLinkFor('vlad/eng-123-fix-login', 'acme'), {
		ticket: 'ENG-123',
		url: 'https://linear.app/acme/issue/ENG-123',
	});
	assert.equal(linearLinkFor('no-ticket-here', 'acme'), null);
	assert.equal(linearLinkFor('vlad/eng-123', ''), null);
	assert.equal(linearLinkFor('vlad/eng-123', 'javascript:alert(1)'), null);
	assert.equal(linearDashboardUrlFor('acme'), 'https://linear.app/acme');
	assert.equal(linearDashboardUrlFor('nope nope'), '');
}

function testTrackerSettingPicksTheLink(): void {
	const both = { jiraBaseUrl: 'acme.atlassian.net', linearWorkspace: 'acme' };

	assert.equal(issueLinkFor('feat/ENG-9', { ...both, issueTracker: 'jira' })?.url, 'https://acme.atlassian.net/browse/ENG-9');
	assert.equal(issueLinkFor('feat/ENG-9', { ...both, issueTracker: 'linear' })?.url, 'https://linear.app/acme/issue/ENG-9');

	// The other tracker's value is kept in settings but never used for the link.
	assert.equal(issueLinkFor('feat/ENG-9', { issueTracker: 'linear', jiraBaseUrl: 'acme.atlassian.net', linearWorkspace: '' }), null);
}

testWorkspaceAcceptsSlugOrPastedLink();
testWorkspaceRejectsEverythingElse();
testCommit();
testLinks();
testTrackerSettingPicksTheLink();
console.log('linear: all checks passed');
