'use strict';

const { expect } = require('chai');
const { Tidy } = require('./main.js');

describe('Tidy scan pattern', () => {
	/** @type {Tidy} */
	let adapter;

	beforeEach(() => {
		adapter = new Tidy({ name: 'tidy' });
	});

	it('should use prefix match for nested states', () => {
		expect(adapter.getScanPattern('0_userdata.0')).to.equal('0_userdata.0.*');
		expect(adapter.getScanPattern('0_userdata')).to.equal('0_userdata*');
		expect(adapter.getScanPattern('alias')).to.equal('alias*');
		expect(adapter.getScanPattern('alias.0')).to.equal('alias.0.*');
	});

	it('should preserve existing wildcards', () => {
		expect(adapter.getScanPattern('0_userdata.0.*')).to.equal('0_userdata.0.*');
	});

	it('should trim trailing dots', () => {
		expect(adapter.getScanPattern('0_userdata.0.')).to.equal('0_userdata.0.*');
	});
});

describe('Tidy exception filtering', () => {
	/** @type {Tidy} */
	let adapter;

	beforeEach(async () => {
		adapter = new Tidy({ name: 'tidy' });
		adapter.config = {
			exceptions: [
				{ id: '0_userdata.0.radio.station', objectType: 'state', name: 'Radio station' },
				{ id: '0_userdata.0.legacy', objectType: 'folder', name: 'Legacy folder' },
			],
		};
		await adapter.loadExceptionSets();
	});

	it('should exclude an exact state match', () => {
		expect(adapter.isExcluded('0_userdata.0.radio.station')).to.be.true;
	});

	it('should not exclude states with a similar prefix', () => {
		expect(adapter.isExcluded('0_userdata.0.radio.station_backup')).to.be.false;
	});

	it('should exclude states under an excluded folder', () => {
		expect(adapter.isExcluded('0_userdata.0.legacy.old_value')).to.be.true;
	});

	it('should not exclude unrelated states', () => {
		expect(adapter.isExcluded('0_userdata.0.active.sensor')).to.be.false;
	});

	it('should treat entries without objectType as single states', async () => {
		adapter.config.exceptions = [{ id: 'hm-rpc.0.ABC123.STATE', objectType: 'state' }];
		await adapter.loadExceptionSets();
		expect(adapter.isExcluded('hm-rpc.0.ABC123.STATE')).to.be.true;
		expect(adapter.isExcluded('hm-rpc.0.ABC123.OTHER')).to.be.false;
	});

	it('should exclude states matching a wildcard suffix pattern', async () => {
		adapter.config.exceptions = [{ id: '0_userdata.0.rollo.trigger*' }];
		await adapter.loadExceptionSets();
		expect(adapter.isExcluded('0_userdata.0.rollo.trigger1_minute')).to.be.true;
		expect(adapter.isExcluded('0_userdata.0.rollo.trigger1_stunde')).to.be.true;
		expect(adapter.isExcluded('0_userdata.0.rollo.trigger2_minute')).to.be.true;
		expect(adapter.isExcluded('0_userdata.0.rollo.mode')).to.be.false;
	});

	it('should exclude states matching a single-character wildcard', async () => {
		adapter.config.exceptions = [{ id: '0_userdata.0.sensor_?' }];
		await adapter.loadExceptionSets();
		expect(adapter.isExcluded('0_userdata.0.sensor_1')).to.be.true;
		expect(adapter.isExcluded('0_userdata.0.sensor_12')).to.be.false;
	});

	it('should convert wildcard patterns to anchored regular expressions', () => {
		expect(adapter.wildcardToRegExp('0_userdata.0.rollo.trigger*').test('0_userdata.0.rollo.trigger1_minute')).to
			.be.true;
		expect(adapter.wildcardToRegExp('0_userdata.0.rollo.trigger*').test('0_userdata.0.rollo.other')).to.be.false;
	});
});

describe('Tidy alias target IDs', () => {
	/** @type {Tidy} */
	let adapter;

	beforeEach(() => {
		adapter = new Tidy({ name: 'tidy' });
	});

	it('should return a single string alias target', () => {
		expect(adapter.getAliasTargetIds('hm-rpc.0.ABC123.STATE')).to.deep.equal(['hm-rpc.0.ABC123.STATE']);
	});

	it('should return read and write alias targets separately', () => {
		expect(
			adapter.getAliasTargetIds({
				read: 'sprinklecontrol.0.sprinkle.Gabione.countdown',
				write: 'sprinklecontrol.0.sprinkle.Gabione.runningTime',
			}),
		).to.deep.equal([
			'sprinklecontrol.0.sprinkle.Gabione.countdown',
			'sprinklecontrol.0.sprinkle.Gabione.runningTime',
		]);
	});

	it('should ignore empty read or write values', () => {
		expect(adapter.getAliasTargetIds({ read: 'some.state', write: '' })).to.deep.equal(['some.state']);
	});

	it('should return an empty array for missing alias targets', () => {
		expect(adapter.getAliasTargetIds(null)).to.deep.equal([]);
		expect(adapter.getAliasTargetIds({})).to.deep.equal([]);
	});
});

describe('Tidy result serialization', () => {
	/** @type {Tidy} */
	let adapter;

	beforeEach(() => {
		adapter = new Tidy({ name: 'tidy' });
	});

	it('should truncate long string values for result storage', () => {
		const longValue = 'x'.repeat(500);
		const formatted = adapter.formatResultValue(longValue);
		expect(formatted).to.equal(`${'x'.repeat(200)}…`);
		expect(formatted.length).to.equal(201);
	});

	it('should keep short primitive values unchanged', () => {
		expect(adapter.formatResultValue(42)).to.equal(42);
		expect(adapter.formatResultValue(true)).to.equal(true);
		expect(adapter.formatResultValue('short')).to.equal('short');
	});

	it('should truncate large object values to a JSON preview', () => {
		const largeObject = { data: 'y'.repeat(500) };
		const formatted = adapter.formatResultValue(largeObject);
		expect(formatted).to.be.a('string');
		expect(formatted.endsWith('…')).to.be.true;
		expect(formatted.length).to.equal(201);
	});

	it('should measure value size without throwing on huge values', () => {
		const huge = { data: 'z'.repeat(1_000_000) };
		expect(() => adapter.getValueSize(huge)).to.not.throw();
		expect(adapter.getValueSize(huge)).to.be.greaterThan(1_000_000);
	});

	it('should fall back to entries without value when JSON is too large', () => {
		const originalStringify = JSON.stringify;
		let callCount = 0;
		JSON.stringify = value => {
			callCount++;
			if (callCount === 1) {
				const error = new Error('Invalid string length');
				throw error;
			}
			return originalStringify(value);
		};

		try {
			const results = [{ id: 'test.0.state', value: 'preview', issue: null }];
			const json = adapter.stringifyScanResults(results);
			expect(JSON.parse(json)).to.deep.equal([{ id: 'test.0.state', issue: null }]);
		} finally {
			JSON.stringify = originalStringify;
		}
	});
});
