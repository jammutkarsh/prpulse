// Linear's counterpart to `jira.ts`. A Linear issue link needs only the workspace slug, so the
// "base URL" here is one path segment — but it still comes from the user and still ends up in an
// href, so it goes through the same kind of sanitising.

import { jiraTicketFor, type JiraLink } from './jira';

/** Workspace slugs are letters, digits and dashes. Anything else never reaches a URL. */
const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

const LINEAR_HOSTS = new Set(['linear.app', 'www.linear.app']);

/**
 * Accepts what users actually have on hand: the bare slug (`acme`) or any pasted Linear link
 * (`https://linear.app/acme/issue/ENG-1/title`). Returns the slug, or `''` when there is none.
 */
export function sanitizeLinearWorkspace(value: string): string {
	const trimmed = value?.trim();
	if (!trimmed) return '';

	if (WORKSPACE_PATTERN.test(trimmed)) return trimmed.toLowerCase();

	const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
	let parsed: URL;
	try {
		parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
	} catch {
		return '';
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
	if (!LINEAR_HOSTS.has(parsed.hostname.toLowerCase())) return '';

	const workspace = parsed.pathname.split('/').find(Boolean) ?? '';
	return WORKSPACE_PATTERN.test(workspace) ? workspace.toLowerCase() : '';
}

/** What to store on commit: `''` for a blank field, `null` when something unusable was typed. */
export function commitLinearWorkspace(typed: string): string | null {
	if (!typed.trim()) return '';

	return sanitizeLinearWorkspace(typed) || null;
}

export function linearDashboardUrlFor(workspace: string): string {
	const slug = sanitizeLinearWorkspace(workspace);
	return slug ? `https://linear.app/${slug}` : '';
}

/** Linear issue ids have the same `KEY-123` shape as Jira's, so the branch rule is shared. */
export function linearLinkFor(branchName: string, workspace: string): JiraLink | null {
	if (!branchName || !workspace) return null;

	const ticket = jiraTicketFor(branchName);
	const slug = sanitizeLinearWorkspace(workspace);
	if (!ticket || !slug) return null;

	return { ticket, url: `https://linear.app/${slug}/issue/${ticket}` };
}
