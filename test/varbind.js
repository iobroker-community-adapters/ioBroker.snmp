'use strict';

/*
 * Unit tests for the value conversion (src/lib/varbind.ts, src/lib/utils.ts).
 *
 * The focus is the hex dump format: a binary octet string is what a device answers for maintenance
 * data, and the adapter has to show it the way a MIB browser does. The TypeScript source is loaded
 * directly through tsx - see the `test:unit` script.
 */

const assert = require('node:assert');
const { ObjectType } = require('net-snmp');

const { varbindDecode, varbindEncode } = require('../src/lib/varbind.ts');
const { F_TEXT, F_NUMERIC, F_BOOLEAN, F_JSON, F_HEX } = require('../src/lib/constants.ts');

/** a logger which keeps the warnings, so that a test can check that one was issued */
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

/**
 * decode - one varbind through the decoder
 *
 * @param type snmp object type
 * @param value value as net-snmp delivers it
 * @param format one of the F_* formats
 * @returns the decoded varbind plus the logger
 */
function decode(type, value, format) {
    const log = makeLog();
    return { ...varbindDecode({ oid: '1.2.3.4.0', type, value }, format, 'dev', 'state', log), log };
}

describe('varbindDecode with the hex dump format', () => {
    it('converts the binary data of an octet string, the reason for this format', () => {
        // the value of the forum report: maintenance data of a printer
        const value = Buffer.from([0x76, 0x01, 0x04, 0x00, 0x00, 0x00, 0x01, 0x79, 0x01, 0x04, 0x00, 0x00, 0x27, 0x10]);
        const result = decode(ObjectType.OctetString, value, F_HEX);

        assert.strictEqual(result.val, '76 01 04 00 00 00 01 79 01 04 00 00 27 10');
        assert.strictEqual(result.qual, 0x00);
        assert.strictEqual(result.format, F_HEX);
        assert.deepStrictEqual(result.log.warnings, []);
    });

    it('leaves the other formats of an octet string untouched', () => {
        const value = Buffer.from('abc');
        assert.strictEqual(decode(ObjectType.OctetString, value, F_TEXT).val, 'abc');
        assert.strictEqual(decode(ObjectType.OctetString, value, F_JSON).val, JSON.stringify(value));
    });

    it('converts an integer and a counter64', () => {
        assert.strictEqual(decode(ObjectType.Integer32, 10000, F_HEX).val, '27 10');
        assert.strictEqual(decode(ObjectType.Counter64, Buffer.from([0, 0, 0, 0, 0, 0, 0x27, 0x10]), F_HEX).val,
            '00 00 00 00 00 00 27 10');
    });

    it('converts a boolean into one byte', () => {
        assert.strictEqual(decode(ObjectType.Boolean, true, F_HEX).val, '01');
        assert.strictEqual(decode(ObjectType.Boolean, false, F_HEX).val, '00');
    });

    it('converts opaque data of any content, where the other formats give up', () => {
        const value = Buffer.from([0x01, 0x02, 0x03]);
        const result = decode(ObjectType.Opaque, value, F_HEX);

        assert.strictEqual(result.val, '01 02 03');
        assert.strictEqual(result.qual, 0x00);

        // without the hex dump such a value is an error
        assert.strictEqual(decode(ObjectType.Opaque, value, F_TEXT).qual, 0x01);
    });

    it('refuses an oid and an ip address, which carry no bytes of their own', () => {
        for (const type of [ObjectType.OID, ObjectType.IpAddress]) {
            const result = decode(type, '1.2.3.4', F_HEX);
            assert.strictEqual(result.val, null);
            assert.strictEqual(result.qual, 0x01);
            assert.strictEqual(result.log.warnings.length, 1, 'the reason has to be logged');
        }
    });
});

describe('varbindEncode with the hex dump format', () => {
    /**
     * encode - one value through the encoder
     *
     * @param type snmp object type of the oid
     * @param data value of the state
     * @param format one of the F_* formats
     * @returns the encoded varbind plus the logger
     */
    function encode(type, data, format) {
        const log = makeLog();
        const state = { varbind: { oid: '1.2.3.4.0', type, value: null }, format };
        return { ...varbindEncode(state, data, 'dev', 'state', log), log };
    }

    it('writes the bytes of the hex dump back into an octet string', () => {
        const result = encode(ObjectType.OctetString, '76 01 04 00 27 10', F_HEX);
        assert.deepStrictEqual(result.value, Buffer.from([0x76, 0x01, 0x04, 0x00, 0x27, 0x10]));
    });

    it('accepts what a MIB browser shows, with 0x and without blanks', () => {
        assert.deepStrictEqual(encode(ObjectType.OctetString, '0x76 01', F_HEX).value, Buffer.from([0x76, 0x01]));
        assert.deepStrictEqual(encode(ObjectType.OctetString, '7601', F_HEX).value, Buffer.from([0x76, 0x01]));
    });

    it('reads the bytes as one number for an integer', () => {
        assert.strictEqual(encode(ObjectType.Integer32, '27 10', F_HEX).value, 10000);
    });

    it('rejects text which is not a hex dump', () => {
        const result = encode(ObjectType.OctetString, 'no hex here', F_HEX);
        assert.strictEqual(result.value, null);
        assert.strictEqual(result.log.warnings.length, 1);
    });

    it('does not touch the other formats', () => {
        assert.strictEqual(encode(ObjectType.OctetString, 'plain text', F_TEXT).value, 'plain text');
        assert.strictEqual(encode(ObjectType.Integer32, 42, F_NUMERIC).value, 42);
        assert.strictEqual(encode(ObjectType.Boolean, true, F_BOOLEAN).value, true);
    });
});
