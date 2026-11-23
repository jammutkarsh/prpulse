// One question for every surface that draws a ticket link: given a branch and the user's settings,
// where does the ticket live? Which tracker answers is a setting, not something a card should know.

import { jiraLinkFor, type JiraLink } from './jira';
import { linearLinkFor } from './linear';
import type { Settings } from './types';

export type IssueTrackerSettings = Pick<Settings, 'issueTracker' | 'jiraBaseUrl' | 'linearWorkspace'>;

export const NO_ISSUE_TRACKER: IssueTrackerSettings = { issueTracker: 'jira', jiraBaseUrl: '', linearWorkspace: '' };

export function issueLinkFor(branchName: string, settings: IssueTrackerSettings): JiraLink | null {
	return settings.issueTracker === 'linear'
		? linearLinkFor(branchName, settings.linearWorkspace)
		: jiraLinkFor(branchName, settings.jiraBaseUrl);
}
