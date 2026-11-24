import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { POPUP_PATH, SIDEBAR_PATH } from '../extension/lib/dashboard-paths';

type BrowserTarget = 'chrome' | 'firefox';

type ExtensionManifest = {
	manifest_version: 3;
	name: string;
	version: string;
	description: string;
	permissions: string[];
	optional_permissions: string[];
	host_permissions: string[];
	action: {
		default_popup: string;
		default_icon: Record<string, string>;
	};
	background:
		| {
				service_worker: string;
				type: 'module';
		  }
		| {
				scripts: string[];
				type: 'module';
		  };
	options_page: string;
	icons: Record<string, string>;
	/** Firefox's sidebar. */
	sidebar_action?: {
		default_panel: string;
		default_title: string;
		default_icon: Record<string, string>;
		open_at_install: boolean;
	};
	/** Chrome's side panel. */
	side_panel?: { default_path: string };
	browser_specific_settings?: {
		gecko: {
			id: string;
			strict_min_version: string;
			data_collection_permissions?: {
				required: string[];
				optional: string[];
			};
		};
	};
};

const browser = process.argv[2] as BrowserTarget | undefined;
const outputPath = process.argv[3];

if (!browser || !outputPath || !isBrowserTarget(browser)) {
	throw new Error('Usage: tsx scripts/generate-manifest.ts <chrome|firefox> <output-path>');
}

// Read version from package.json
const packageJsonPath = resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;

if (!packageVersion) {
	throw new Error('Version not found in package.json');
}

const baseManifest = {
	manifest_version: 3,
	name: 'PR Pulse - GitHub Pull Request Dashboard',
	version: packageVersion,
	description: 'PR Pulse is a Pull Request dashboard for GitHub, delivered as a browser extension. Say No to Navigation!',
	permissions: ['storage', 'alarms'],
	// Optional, not required: adding a warning-generating permission to an existing install disables
	// the extension in Chrome until the user re-approves it. Requested from the popup's Enable button.
	optional_permissions: ['notifications'],
	host_permissions: ['https://api.github.com/*'],
	action: {
		default_popup: POPUP_PATH,
		default_icon: {
			'64': 'icons/icon48.png',
			'128': 'icons/icon128.png',
		},
	},
	options_page: 'settings/settings.html',
	icons: {
		'64': 'icons/icon48.png',
		'128': 'icons/icon128.png',
	},
} satisfies Omit<ExtensionManifest, 'background'>;

const manifest = createManifest(browser, baseManifest);
const resolvedOutputPath = resolve(process.cwd(), outputPath);

mkdirSync(dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

function isBrowserTarget(value: string): value is BrowserTarget {
	return value === 'chrome' || value === 'firefox';
}

function createManifest(target: BrowserTarget, base: Omit<ExtensionManifest, 'background'>): ExtensionManifest {
	if (target === 'firefox') {
		return {
			...base,
			background: {
				scripts: ['service-worker.js'],
				type: 'module',
			},
			sidebar_action: {
				default_panel: SIDEBAR_PATH,
				default_title: 'PR Pulse',
				default_icon: base.icons,
				// Firefox opens a new sidebar on install unless told not to; the sidebar is opt-in here.
				open_at_install: false,
			},
			browser_specific_settings: {
				gecko: {
					id: 'pr-pulse@utkarshchourasia.in',
					strict_min_version: '140.0',
					data_collection_permissions: {
						required: ['none'],
						optional: [],
					},
				},
			},
		};
	}

	// Optional but recommended for Chrome Web Store
	return {
		...base,
		// `sidePanel` carries no install warning, so adding it does not disable existing installs.
		permissions: [...base.permissions, 'sidePanel'],
		side_panel: { default_path: SIDEBAR_PATH },
		background: {
			service_worker: 'service-worker.js',
			type: 'module',
		},
	};
}
