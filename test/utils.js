'use strict';

/*
 * Unit tests for the pure helpers of src/lib/utils.ts.
 *
 * The TypeScript source is loaded directly through tsx - see the `test:unit` script.
 */

const assert = require('node:assert');

const { hexDump, name2id, oidFormat2StateType, oidStateRole } = require('../src/lib/utils.ts');
const { F_TEXT, F_NUMERIC, F_BOOLEAN, F_JSON, F_HEX, F_AUTO } = require('../src/lib/constants.ts');

/** a logger which keeps the warnings */
function makeLog() {
    const warnings = [];
    return {
        warnings,
        silly: () => {},
        debug: () => {},
        info: () => {},
        warn: text => warnings.push(text),
        error: text => warnings.push(text),
    };
}

describe('oidFormat2StateType', () => {
    it('maps every format to the type of the state', () => {
        const log = makeLog();
        assert.strictEqual(oidFormat2StateType(F_TEXT, log), 'string');
        assert.strictEqual(oidFormat2StateType(F_NUMERIC, log), 'number');
        assert.strictEqual(oidFormat2StateType(F_BOOLEAN, log), 'boolean');
        assert.strictEqual(oidFormat2StateType(F_JSON, log), 'string');
        assert.strictEqual(oidFormat2StateType(F_HEX, log), 'string', 'a hex dump is a text');
        assert.strictEqual(oidFormat2StateType(F_AUTO, log), 'mixed');
        assert.deepStrictEqual(log.warnings, []);
    });

    it('falls back to mixed and warns about a format it does not know', () => {
        const log = makeLog();
        assert.strictEqual(oidFormat2StateType(42, log), 'mixed');
        assert.strictEqual(log.warnings.length, 1);
    });
});

describe('oidStateRole', () => {
    /*
     * The roles are the ones of https://www.iobroker.net/#en/documentation/dev/stateroles.md -
     * a state with a role which is not in that list is reported by the adapter checker.
     */
    it('uses value for a number and level as soon as it can be written', () => {
        assert.strictEqual(oidStateRole('number', false), 'value');
        assert.strictEqual(oidStateRole('number', true), 'level');
    });

    it('uses indicator for a boolean and switch as soon as it can be written', () => {
        assert.strictEqual(oidStateRole('boolean', false), 'indicator');
        assert.strictEqual(oidStateRole('boolean', true), 'switch');
    });

    it('uses text for a string, whether it can be written or not', () => {
        assert.strictEqual(oidStateRole('string', false), 'text');
        assert.strictEqual(oidStateRole('string', true), 'text');
    });

    it('falls back to the generic role when the device decides the type', () => {
        assert.strictEqual(oidStateRole('mixed', false), 'state');
        assert.strictEqual(oidStateRole('mixed', true), 'state');
    });
});

describe('hexDump', () => {
    it('renders the bytes of a buffer as upper case pairs', () => {
        assert.strictEqual(hexDump(Buffer.from([0x76, 0x01, 0x04, 0x00, 0x27, 0x10])), '76 01 04 00 27 10');
    });

    it('pads a single byte and keeps the value readable', () => {
        assert.strictEqual(hexDump(Buffer.from([0x0a])), '0A');
        assert.strictEqual(hexDump(Buffer.from([0xff, 0x00])), 'FF 00');
    });

    it('renders a number as its own hexadecimal representation', () => {
        assert.strictEqual(hexDump(10000), '27 10');
        assert.strictEqual(hexDump(42), '2A');
        assert.strictEqual(hexDump(0), '00');
    });

    it('renders a negative number as its 32 bit two complement', () => {
        assert.strictEqual(hexDump(-128), 'FF FF FF 80');
        assert.strictEqual(hexDump(-1), 'FF FF FF FF');
    });

    it('returns an empty string for no bytes', () => {
        assert.strictEqual(hexDump(Buffer.alloc(0)), '');
    });
});

describe('name2id', () => {
    // the expression the adapter passes is `this.FORBIDDEN_CHARS` of adapter-core
    const forbidden = /[\][*,;'"`<>\\?]/g;

    it('replaces the characters ioBroker does not allow in an id', () => {
        assert.strictEqual(name2id('a*b?c', forbidden), 'a_b_c');
    });

    it('replaces blanks and dashes, which would be hard to address in a script', () => {
        assert.strictEqual(name2id('toner black-level 1', forbidden), 'toner_black_level_1');
    });

    it('keeps the dots, they build the folder structure', () => {
        assert.strictEqual(name2id('system.uptime', forbidden), 'system.uptime');
    });
});
