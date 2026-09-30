'use strict';

/*
 * Unit tests for the request/answer trace of src/lib/snmpSession.ts (option `optTrace`).
 *
 * The session helpers are tested without a session: that path is the one which needs no device, and
 * it still has to write both lines of the trace. The TypeScript source is loaded through tsx - see
 * the `test:unit` script.
 */

const assert = require('node:assert');

const {
    snmpSessionGetAsync,
    snmpSessionGetNextAsync,
    snmpSessionSetAsync,
    snmpSessionSubtreeAsync,
} = require('../src/lib/snmpSession.ts');

/** a logger which keeps what was written */
function makeLog() {
    const infos = [];
    return {
        infos,
        silly: () => {},
        debug: () => {},
        info: text => infos.push(text),
        warn: text => infos.push(text),
        error: text => infos.push(text),
    };
}

describe('the trace of the snmp requests', () => {
    it('writes request and answer as json when a device is given', async () => {
        const log = makeLog();
        await snmpSessionGetAsync(null, ['1.3.6.1.2.1.1.5.0'], log, 'printer');

        assert.deepStrictEqual(log.infos, [
            '[trace] [printer] get request ["1.3.6.1.2.1.1.5.0"]',
            '[trace] [printer] get answer {"err":"no active session","varbinds":[]}',
        ]);
    });

    it('stays silent while the option is off', async () => {
        const log = makeLog();
        await snmpSessionGetAsync(null, ['1.3.6.1.2.1.1.5.0'], log);

        assert.deepStrictEqual(log.infos, []);
    });

    it('covers every request type the adapter sends', async () => {
        const log = makeLog();
        await snmpSessionSetAsync(null, [{ oid: '1.2.3.0', type: 4, value: 'x' }], log, 'printer');
        await snmpSessionGetNextAsync(null, ['1.2.3'], log, 'printer');
        await snmpSessionSubtreeAsync(null, '1.2.3', 100, log, 'printer');

        assert.deepStrictEqual(
            log.infos.map(text => text.replace('[trace] [printer] ', '').split(' ')[0]),
            ['set', 'set', 'getNext', 'getNext', 'subtree', 'subtree'],
        );
        assert.ok(
            log.infos[0].includes('"oid":"1.2.3.0"'),
            'the varbind of a set belongs into the trace as json',
        );
        assert.ok(log.infos[4].includes('"maxCount":100'), 'the limit of a subtree belongs into the trace');
    });
});
