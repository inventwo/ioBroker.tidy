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
});
