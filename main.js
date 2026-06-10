'use strict';

/*
 * Created with @iobroker/create-adapter v3.1.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

class Tidy extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	constructor(options) {
		super({
			...options,
			name: 'tidy',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('objectChange', this.onObjectChange.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.scanInterval = undefined;
		this._exceptionExact = undefined;
		this._exceptionPrefixes = undefined;
		this._unloading = false;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.log.info('Starting Tidy adapter...');

		await this.ensureAdapterRootMeta();

		// Validate configuration
		if (!this.config.paths || !Array.isArray(this.config.paths)) {
			this.log.error('No paths configured! Please configure at least one path to scan.');
			return;
		}

		// Create objects for each configured path
		await this.createPathObjects();

		// Create objects for complete scan if enabled
		if (this.config.scanAllObjects) {
			await this.createCompleteObjects();
		}

		// Subscribe to trigger states
		this.subscribeStates('*.trigger');

		// Run initial scan for all enabled paths
		await this.scanAllPaths();

		// Run complete scan if enabled
		if (this.config.scanAllObjects) {
			await this.scanComplete();
		}

		// Reload config when instance settings are saved in admin
		this.subscribeForeignObjects(`system.adapter.${this.namespace}`);

		// Setup automatic scanning if enabled
		if (this.config.autoScan && this.config.scanInterval > 0) {
			const intervalMs = this.config.scanInterval * 60 * 60 * 1000; // Convert hours to milliseconds
			this.log.info(`Automatic scanning enabled: Every ${this.config.scanInterval} hour(s)`);
			this.scanInterval = this.setInterval(async () => {
				this.log.info('Running automatic scan...');
				await this.scanAllPaths();
				if (this.config.scanAllObjects) {
					await this.scanComplete();
				}
			}, intervalMs);
		}
	}
	/**
	 * Ensure adapter root (e.g. tidy) is typed as meta.
	 * instanceObjects handles tidy.0; objects with _id "" fails on adapter update (Invalid ID).
	 */
	async ensureAdapterRootMeta() {
		const rootId = this.name;
		const titleLang = this.ioPack?.common?.titleLang || {};
		const metaObject = {
			type: 'meta',
			common: {
				name: titleLang[this.language] || titleLang.en || rootId,
				type: 'meta.folder',
			},
			native: {},
		};

		const existing = await this.getForeignObjectAsync(rootId);
		if (!existing) {
			await this.setForeignObjectAsync(rootId, metaObject);
		} else if (existing.type !== 'meta') {
			await this.extendForeignObjectAsync(rootId, {
				type: 'meta',
				common: metaObject.common,
			});
		}
	}

	/**
	 * Create channel and states for complete scan
	 */
	async createCompleteObjects() {
		const channelId = 'complete';
		// Channel
		await this.setObjectNotExistsAsync(channelId, {
			type: 'channel',
			common: { name: 'Scan results for complete object tree' },
			native: {},
		});
		// States
		await this.setObjectNotExistsAsync(`${channelId}.trigger`, {
			type: 'state',
			common: {
				name: 'Trigger complete scan',
				type: 'boolean',
				role: 'button',
				read: true,
				write: true,
				def: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.result`, {
			type: 'state',
			common: {
				name: 'Complete scan result (JSON table)',
				type: 'string',
				role: 'json',
				read: true,
				write: false,
				def: '[]',
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.lastScan`, {
			type: 'state',
			common: {
				name: 'Last complete scan timestamp',
				type: 'number',
				role: 'value.time',
				read: true,
				write: false,
				def: 0,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.count`, {
			type: 'state',
			common: {
				name: 'Total datapoints found (complete)',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				def: 0,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.deadCount`, {
			type: 'state',
			common: {
				name: 'Dead datapoints (complete)',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				def: 0,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.staleCount`, {
			type: 'state',
			common: {
				name: 'Stale datapoints (complete)',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				def: 0,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.orphanedCount`, {
			type: 'state',
			common: {
				name: 'Orphaned aliases (complete)',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				def: 0,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync(`${channelId}.exceptionCount`, {
			type: 'state',
			common: {
				name: 'Excluded datapoints (complete)',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				def: 0,
			},
			native: {},
		});
	}

	/**
	 * Scan the entire object tree for datapoints
	 */
	async scanComplete() {
		const startTime = Date.now();
		const channelId = 'complete';
		this.log.info('Scanning entire object tree (complete scan) ...');
		await this.loadExceptionSets();
		try {
			const results = [];
			let excludedCount = 0;
			// Get all states in the system
			const objects = await this.getForeignObjectsAsync('*', 'state');
			this.log.debug(`Found ${Object.keys(objects).length} objects in complete scan`);
			for (const [id, obj] of Object.entries(objects)) {
				if (!obj || obj.type !== 'state') {
					continue;
				}
				if (this.isExcluded(id)) {
					excludedCount++;
					continue;
				}
				const state = await this.getForeignStateAsync(id);
				// Use a dummy pathConfig for analyzeDatapoint
				const analysis = await this.analyzeDatapoint(id, obj, state, {});
				if (analysis) {
					results.push(analysis);
				}
			}
			// Sort results by timestamp (oldest first)
			results.sort((a, b) => {
				if (a.last_ts === null) {
					return -1;
				}
				if (b.last_ts === null) {
					return 1;
				}
				return a.last_ts - b.last_ts;
			});
			// Count issues
			const counts = {
				total: results.length,
				dead: results.filter(r => r.issue === 'dead').length,
				stale: results.filter(r => r.issue === 'stale').length,
				orphaned: results.filter(r => r.issue === 'orphaned_alias').length,
			};
			// Store results
			await this.setStateAsync(`${channelId}.result`, JSON.stringify(results), true);
			await this.setStateAsync(`${channelId}.lastScan`, Date.now(), true);
			await this.setStateAsync(`${channelId}.count`, counts.total, true);
			await this.setStateAsync(`${channelId}.deadCount`, counts.dead, true);
			await this.setStateAsync(`${channelId}.staleCount`, counts.stale, true);
			await this.setStateAsync(`${channelId}.orphanedCount`, counts.orphaned, true);
			await this.setStateAsync(`${channelId}.exceptionCount`, excludedCount, true);
			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			this.log.info(
				`Complete scan finished: ${counts.total} datapoints (${counts.dead} dead, ${counts.stale} stale, ${counts.orphaned} orphaned, ${excludedCount} excluded) in ${duration}s`,
			);
		} catch (error) {
			if (this._unloading) {
				this.log.debug(`Complete scan aborted during shutdown: ${error.message}`);
			} else {
				this.log.error(`Error during complete scan: ${error.message}`);
			}
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param {() => void} callback - Callback function
	 */
	onUnload(callback) {
		this._unloading = true;
		try {
			// Clear automatic scan interval
			if (this.scanInterval) {
				this.clearInterval(this.scanInterval);
				this.scanInterval = undefined;
			}

			callback();
		} catch (error) {
			this.log.error(`Error during unloading: ${error.message}`);
			callback();
		}
	}

	/**
	 * Create channel and states for each configured path
	 */
	async createPathObjects() {
		for (const pathConfig of this.config.paths) {
			if (pathConfig.enabled === false || !(pathConfig.name || pathConfig.path)) {
				continue;
			}

			const channelId = this.getChannelId(pathConfig);

			// Create channel
			await this.setObjectNotExistsAsync(channelId, {
				type: 'channel',
				common: {
					name: `Scan results for ${pathConfig.path}`,
				},
				native: {},
			});

			// Create trigger state
			await this.setObjectNotExistsAsync(`${channelId}.trigger`, {
				type: 'state',
				common: {
					name: 'Trigger scan',
					type: 'boolean',
					role: 'button',
					read: true,
					write: true,
					def: false,
				},
				native: {},
			});

			// Create result state
			await this.setObjectNotExistsAsync(`${channelId}.result`, {
				type: 'state',
				common: {
					name: 'Scan result (JSON table)',
					type: 'string',
					role: 'json',
					read: true,
					write: false,
					def: '[]',
				},
				native: {},
			});

			// Create last scan timestamp
			await this.setObjectNotExistsAsync(`${channelId}.lastScan`, {
				type: 'state',
				common: {
					name: 'Last scan timestamp',
					type: 'number',
					role: 'value.time',
					read: true,
					write: false,
					def: 0,
				},
				native: {},
			});

			// Create count states
			await this.setObjectNotExistsAsync(`${channelId}.count`, {
				type: 'state',
				common: {
					name: 'Total datapoints found',
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
				native: {},
			});

			await this.setObjectNotExistsAsync(`${channelId}.deadCount`, {
				type: 'state',
				common: {
					name: 'Dead datapoints',
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
				native: {},
			});

			await this.setObjectNotExistsAsync(`${channelId}.staleCount`, {
				type: 'state',
				common: {
					name: 'Stale datapoints',
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
				native: {},
			});

			await this.setObjectNotExistsAsync(`${channelId}.orphanedCount`, {
				type: 'state',
				common: {
					name: 'Orphaned aliases',
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
				native: {},
			});

			await this.setObjectNotExistsAsync(`${channelId}.exceptionCount`, {
				type: 'state',
				common: {
					name: 'Excluded datapoints',
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
				native: {},
			});
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	/**
	 * Is called if a subscribed object changes
	 *
	 * @param {string} id - Object ID
	 * @param {ioBroker.Object | null | undefined} obj - Object definition
	 */
	async onObjectChange(id, obj) {
		if (id !== `system.adapter.${this.namespace}` || !obj?.native) {
			return;
		}

		this.log.info('Configuration updated — reloading paths and rescanning');
		Object.assign(this.config, obj.native);
		await this.createPathObjects();
		await this.scanAllPaths();
	}

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param {string} id - State ID
	 * @param {ioBroker.State | null | undefined} state - State object
	 */
	async onStateChange(id, state) {
		if (state && !state.ack && state.val === true && id.endsWith('.trigger')) {
			await this.reloadConfig();

			// Trigger button was pressed
			this.log.info(`Manual scan triggered for ${id}`);

			const channelId = id.replace(`${this.namespace}.`, '').replace('.trigger', '');
			const pathConfig = this.config.paths.find(p => this.getChannelId(p) === channelId);

			if (pathConfig && pathConfig.enabled !== false) {
				await this.scanPath(pathConfig);
			}

			// Complete scan trigger
			if (this.config.scanAllObjects && channelId === 'complete') {
				await this.scanComplete();
			}

			// Reset trigger
			await this.setStateAsync(id, false, true);
		}
	}

	/**
	 * Scan all enabled paths
	 */
	async scanAllPaths() {
		await this.reloadConfig();

		for (const pathConfig of this.config.paths) {
			if (pathConfig.enabled !== false && (pathConfig.name || pathConfig.path)) {
				await this.scanPath(pathConfig);
			}
		}
	}

	/**
	 * Scan a single path for datapoints
	 *
	 * @param {object} pathConfig - Path configuration object
	 */
	async scanPath(pathConfig) {
		const startTime = Date.now();
		await this.reloadConfig();
		const config = this.config.paths.find(p => p.path === pathConfig.path && p.enabled !== false) || pathConfig;

		this.log.info(`Scanning path: ${config.path}`);
		await this.loadExceptionSets();

		try {
			const channelId = this.getChannelId(config);
			const results = [];
			let excludedCount = 0;

			// Get all objects under the specified path (prefix match for any depth)
			const pattern = this.getScanPattern(config.path);
			const objects = await this.getForeignObjectsAsync(pattern, 'state');

			this.log.debug(
				`Scan pattern "${pattern}": found ${Object.keys(objects).length} objects under ${config.path}`,
			);

			// Analyze each object
			for (const [id, obj] of Object.entries(objects)) {
				if (!obj || obj.type !== 'state') {
					continue;
				}
				if (this.isExcluded(id)) {
					excludedCount++;
					continue;
				}

				const state = await this.getForeignStateAsync(id);
				const analysis = await this.analyzeDatapoint(id, obj, state, config);

				if (analysis) {
					results.push(analysis);
				}
			}

			// Sort results by timestamp (oldest first)
			results.sort((a, b) => {
				if (a.last_ts === null) {
					return -1;
				}
				if (b.last_ts === null) {
					return 1;
				}
				return a.last_ts - b.last_ts;
			});

			// Count issues
			const counts = {
				total: results.length,
				dead: results.filter(r => r.issue === 'dead').length,
				stale: results.filter(r => r.issue === 'stale').length,
				orphaned: results.filter(r => r.issue === 'orphaned_alias').length,
			};

			// Store results
			await this.setStateAsync(`${channelId}.result`, JSON.stringify(results), true);
			await this.setStateAsync(`${channelId}.lastScan`, Date.now(), true);
			await this.setStateAsync(`${channelId}.count`, counts.total, true);
			await this.setStateAsync(`${channelId}.deadCount`, counts.dead, true);
			await this.setStateAsync(`${channelId}.staleCount`, counts.stale, true);
			await this.setStateAsync(`${channelId}.orphanedCount`, counts.orphaned, true);
			await this.setStateAsync(`${channelId}.exceptionCount`, excludedCount, true);

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			this.log.info(
				`Scan completed for ${config.path}: ${counts.total} datapoints ` +
					`(${counts.dead} dead, ${counts.stale} stale, ${counts.orphaned} orphaned, ${excludedCount} excluded) in ${duration}s`,
			);
		} catch (error) {
			if (this._unloading) {
				this.log.debug(`Scan for ${config.path} aborted during shutdown: ${error.message}`);
			} else {
				this.log.error(`Error scanning path ${config.path}: ${error.message}`);
			}
		}
	}

	/**
	 * Analyze a single datapoint
	 *
	 * @param {string} id - Datapoint ID
	 * @param {ioBroker.Object} obj - Object definition
	 * @param {ioBroker.State | null | undefined} state - State object
	 * @param {object} pathConfig - Path configuration
	 * @returns {Promise<object|null>} Analysis result
	 */
	async analyzeDatapoint(id, obj, state, pathConfig) {
		const now = Date.now();
		const daysUntilStale = this.config.daysUntilStale || 90;
		const daysUntilDead = this.config.daysUntilDead || 365;

		const result = {
			id: id,
			name: obj.common?.name || id.split('.').pop(),
			last_ts: null,
			last_ts_iso: 'undefined',
			value: null,
			status: 'active',
			status_de: 'aktiv',
			issue: null,
			issue_de: null,
			size: 0,
		};

		// Get timestamp
		if (state && state.ts) {
			result.last_ts = state.ts;
			result.last_ts_iso = new Date(state.ts).toLocaleString('de-DE');
			result.value = state.val;

			// Calculate age in days
			const ageMs = now - state.ts;
			const ageDays = ageMs / (1000 * 60 * 60 * 24);

			if (ageDays > daysUntilDead) {
				result.status = 'dead';
				result.status_de = 'inaktiv';
				result.issue = 'dead';
				result.issue_de = 'inaktiv';
			} else if (ageDays > daysUntilStale) {
				result.status = 'stale';
				result.status_de = 'veraltet';
				result.issue = 'stale';
				result.issue_de = 'veraltet';
			} else {
				// Active datapoint - no issue
				result.status = 'active';
				result.status_de = 'aktiv';
				result.issue = null;
				result.issue_de = null;
			}
		} else {
			// No timestamp = never written
			result.status = 'undefined';
			result.status_de = 'undefiniert';
			result.issue = 'dead';
			result.issue_de = 'inaktiv';
		}

		// Calculate size
		if (state && state.val !== null && state.val !== undefined) {
			result.size = JSON.stringify(state.val).length;
		}

		// Check for orphaned aliases
		if (pathConfig.checkAliasTargets && id.startsWith('alias.')) {
			const targetId = obj.common?.alias?.id;
			if (targetId) {
				const targetExists = await this.getForeignObjectAsync(targetId);
				if (!targetExists) {
					result.status = 'orphaned';
					result.status_de = 'verwaist';
					result.issue = 'orphaned_alias';
					result.issue_de = 'verwaistes Alias';
				}
			}
		}

		return result;
	}

	/**
	 * Build object scan pattern for getForeignObjectsAsync
	 *
	 * Uses prefix matching so all states at any depth are included.
	 * - Adapter prefix (e.g. `0_userdata`, `alias`): `prefix*`
	 * - Instance path (e.g. `alias.0`, `0_userdata.0`): `path.*`
	 *
	 * @param {string} path - Configured scan path
	 * @returns {string} ioBroker object ID pattern
	 */
	getScanPattern(path) {
		const trimmed = String(path || '').trim();

		if (!trimmed) {
			return '*';
		}

		if (trimmed.includes('*')) {
			return trimmed;
		}

		const base = trimmed.replace(/\.$/, '');
		const lastSegment = base.split('.').pop() || '';

		if (/^\d+$/.test(lastSegment)) {
			return `${base}.*`;
		}

		return `${base}*`;
	}

	/**
	 * Reload native configuration from the instance object (after admin save)
	 */
	async reloadConfig() {
		try {
			const instanceObj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);

			if (instanceObj?.native) {
				Object.assign(this.config, instanceObj.native);
			}
		} catch (error) {
			this.log.debug(`Could not reload config: ${error.message}`);
		}
	}

	/**
	 * Build lookup structures for configured scan exceptions
	 */
	async loadExceptionSets() {
		this._exceptionExact = new Set();
		this._exceptionPrefixes = [];

		for (const exc of this.config.exceptions || []) {
			if (!exc?.id || !String(exc.id).trim()) {
				continue;
			}
			if (exc.enabled === false) {
				continue;
			}

			const id = String(exc.id).trim();
			let objectType = exc.objectType;

			if (!objectType) {
				try {
					const obj = await this.getForeignObjectAsync(id);
					objectType = obj?.type === 'state' ? 'state' : 'folder';
				} catch {
					objectType = 'state';
				}
			}

			if (objectType === 'state') {
				this._exceptionExact.add(id);
			} else {
				this._exceptionPrefixes.push(id);
			}
		}
	}

	buildExceptionSets() {
		this._exceptionExact = new Set();
		this._exceptionPrefixes = [];

		for (const exc of this.config.exceptions || []) {
			if (!exc?.id || !String(exc.id).trim()) {
				continue;
			}
			if (exc.enabled === false) {
				continue;
			}

			const id = String(exc.id).trim();
			const objectType = exc.objectType || 'state';

			if (objectType === 'state') {
				this._exceptionExact.add(id);
			} else {
				this._exceptionPrefixes.push(id);
			}
		}
	}

	/**
	 * Check whether a state ID is excluded from scan results
	 *
	 * @param {string} stateId - State ID to check
	 * @returns {boolean} True if the state should be excluded
	 */
	isExcluded(stateId) {
		if (!this._exceptionExact) {
			this.buildExceptionSets();
		}

		if (this._exceptionExact.has(stateId)) {
			return true;
		}

		for (const prefix of this._exceptionPrefixes) {
			if (stateId === prefix || stateId.startsWith(`${prefix}.`)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Resolve channel ID from path config (name with fallback to path)
	 *
	 * @param {object} pathConfig - Path configuration object
	 * @returns {string} Sanitized channel ID
	 */
	getChannelId(pathConfig) {
		const effectiveName = pathConfig.name && pathConfig.name.trim() ? pathConfig.name : pathConfig.path;
		return this.sanitizeName(effectiveName);
	}

	/**
	 * Sanitize name for use as object ID
	 *
	 * @param {string} name - Name to sanitize
	 * @returns {string} Sanitized name
	 */
	sanitizeName(name) {
		return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
	}
	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === 'object' && obj.message) {
	// 		if (obj.command === 'send') {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info('send command');

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	// 		}
	// 	}
	// }
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	module.exports = options => new Tidy(options);
} else {
	// otherwise start the instance directly
	new Tidy();
}
