// Which repositories the dashboard is about at all. Unlike the popup's filters this is configuration:
// a standing list of patterns from settings, applied before the view sees anything, so the tab counts
// and the badge agree with the list.

import type { Settings } from './types';

export type RepoFilterSettings = Pick<Settings, 'repoFilterEnabled' | 'repoInclude' | 'repoExclude'>;

/** `owner/repo`, or a bare `owner`. `*` is the only wildcard; every other character is literal. */
const PATTERN_SHAPE = /^[\w.*-]+(\/[\w.*-]+)?$/;

export function isValidRepoPattern(pattern: string): boolean {
	return PATTERN_SHAPE.test(pattern);
}

/**
 * Splits what was typed into a settings box into patterns: one per line, commas and spaces also
 * separate. `invalid` holds the entries that cannot be a pattern, so the page can name them.
 */
export function parseRepoPatterns(text: string): { patterns: string[]; invalid: string[] } {
	const entries = Array.from(new Set((text || '').split(/[\s,]+/).filter(Boolean)));

	return {
		patterns: entries.filter(isValidRepoPattern),
		invalid: entries.filter((entry) => !isValidRepoPattern(entry)),
	};
}

function escapeRegExp(text: string): string {
	return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `*` matches any run of characters within one side of the slash, never across it: `foo-*` must not
 * swallow `foo-x/anything`. A pattern with no slash names an owner, so `acme` means `acme/*`.
 * GitHub treats names case-insensitively, and so does this.
 */
function compile(pattern: string): RegExp | null {
	const trimmed = pattern.trim();
	if (!isValidRepoPattern(trimmed)) return null;

	const full = trimmed.includes('/') ? trimmed : `${trimmed}/*`;
	return new RegExp(`^${full.split('*').map(escapeRegExp).join('[^/]*')}$`, 'i');
}

function compileAll(patterns: string[] | undefined): RegExp[] {
	return (patterns ?? []).map(compile).filter((matcher): matcher is RegExp => matcher !== null);
}

export function matchesRepoPattern(repoFullName: string, pattern: string): boolean {
	return compile(pattern)?.test(repoFullName) ?? false;
}

export function hasRepoRules(settings: Pick<RepoFilterSettings, 'repoInclude' | 'repoExclude'>): boolean {
	return compileAll(settings.repoInclude).length + compileAll(settings.repoExclude).length > 0;
}

/**
 * Include first, then exclude: an empty include list lets everything in, and an exclude always wins.
 * Returns the input untouched when filtering is switched off or there is nothing to apply.
 */
export function applyRepoFilter<T extends { repoFullName: string }>(items: T[], settings: RepoFilterSettings): T[] {
	if (!settings.repoFilterEnabled) return items;

	const include = compileAll(settings.repoInclude);
	const exclude = compileAll(settings.repoExclude);
	if (include.length + exclude.length === 0) return items;

	return items.filter((item) => {
		const repo = item.repoFullName || '';
		if (include.length > 0 && !include.some((matcher) => matcher.test(repo))) return false;
		return !exclude.some((matcher) => matcher.test(repo));
	});
}
