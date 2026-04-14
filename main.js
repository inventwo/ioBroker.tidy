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
		this.on('unload', this.onUnload.bind(this));

		this.scanInterval = undefined;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.log.info('Starting Tidy adapter...');

		// Validate configuration
		if (!this.config.paths || !Array.isArray(this.config.paths)) {
			this.log.error('No paths configured! Please configure at least one path to scan.');
			return;
		}

		// Create objects for each configured path
		await this.createPathObjects();

		// Subscribe to trigger states
		this.subscribeStates('*.trigger');

		// Run initial scan for all enabled paths
		await this.scanAllPaths();

		// Setup automatic scanning if enabled
		if (this.config.autoScan && this.config.scanInterval > 0) {
			const intervalMs = this.config.scanInterval * 60 * 60 * 1000; // Convert hours to milliseconds
			this.log.info(`Automatic scanning enabled: Every ${this.config.scanInterval} hour(s)`);
			this.scanInterval = setInterval(async () => {
				this.log.info('Running automatic scan...');
				await this.scanAllPaths();
			}, intervalMs);
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param {() => void} callback - Callback function
	 */
	onUnload(callback) {
		try {
			// Clear automatic scan interval
			if (this.scanInterval) {
				clearInterval(this.scanInterval);
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
			if (!pathConfig.enabled || !pathConfig.name) {
				continue;
			}

			const channelId = this.sanitizeName(pathConfig.name);

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
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param {string} id - State ID
	 * @param {ioBroker.State | null | undefined} state - State object
	 */
	async onStateChange(id, state) {
		if (state && !state.ack && state.val === true && id.endsWith('.trigger')) {
			// Trigger button was pressed
			this.log.info(`Manual scan triggered for ${id}`);

			// Find the corresponding path config
			const channelId = id.replace(`${this.namespace}.`, '').replace('.trigger', '');
			const pathConfig = this.config.paths.find(p => this.sanitizeName(p.name) === channelId);

			if (pathConfig && pathConfig.enabled) {
				await this.scanPath(pathConfig);
			}

			// Reset trigger
			await this.setStateAsync(id, false, true);
		}
	}

	/**
	 * Scan all enabled paths
	 */
	async scanAllPaths() {
		for (const pathConfig of this.config.paths) {
			if (pathConfig.enabled) {
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
		this.log.info(`Scanning path: ${pathConfig.path}`);

		try {
			const channelId = this.sanitizeName(pathConfig.name);
			const results = [];

			// Get all objects under the specified path
			const pattern = `${pathConfig.path}.*`;
			const objects = await this.getForeignObjectsAsync(pattern, 'state');

			this.log.debug(`Found ${Object.keys(objects).length} objects under ${pathConfig.path}`);

			// Analyze each object
			for (const [id, obj] of Object.entries(objects)) {
				if (!obj || obj.type !== 'state') {
					continue;
				}

				const state = await this.getForeignStateAsync(id);
				const analysis = await this.analyzeDatapoint(id, obj, state, pathConfig);

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

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			this.log.info(
				`Scan completed for ${pathConfig.path}: ${counts.total} datapoints ` +
					`(${counts.dead} dead, ${counts.stale} stale, ${counts.orphaned} orphaned) in ${duration}s`,
			);
		} catch (error) {
			this.log.error(`Error scanning path ${pathConfig.path}: ${error.message}`);
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
			issue: null,
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
				result.issue = 'dead';
			} else if (ageDays > daysUntilStale) {
				result.status = 'stale';
				result.issue = 'stale';
			}
		} else {
			// No timestamp = never written
			result.status = 'undefined';
			result.issue = 'dead';
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
					result.issue = 'orphaned_alias';
				}
			}
		}

		return result;
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
