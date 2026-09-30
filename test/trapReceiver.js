'use strict';

/*
 * Unit tests for the pure part of the trap handling (src/lib/trapReceiver.ts).
 *
 * The socket itself is not tested here - what has to be right is the way a notification is read:
 * an snmp v1 trap describes itself with four pdu fields, an snmp v2c trap with two varbinds, and
 * both have to end up as the same oid so that a script can compare them.
 */

const assert = require('node:assert');
const snmp = require('net-snmp');

const {
    deviceForTrapAddress,
    normalizeTrapAddress,
    trapIsInform,
    trapOid,
    trapSender,
    trapUpTime,
    trapVersion,
    SNMP_TRAP_OID,
    SYS_UP_TIME_OID,
} = require('../src/lib/trapReceiver.ts');

/** a v2c trap as net-snmp hands it over - sysUpTime.0 and snmpTrapOID.0 come first */
function trapV2(oid, varbinds) {
    return {
        type: snmp.PduType.TrapV2,
        community: 'public',
        varbinds: [
            { oid: SYS_UP_TIME_OID, type: snmp.ObjectType.TimeTicks, value: 4242 },
            { oid: SNMP_TRAP_OID, type: snmp.ObjectType.OID, value: oid },
            ...(varbinds || []),
        ],
    };
}

/** a v1 trap - it has no varbind naming the trap, the pdu fields do that */
function trapV1(fields) {
    return {
        type: snmp.PduType.Trap,
        community: 'public',
        enterprise: '1.3.6.1.4.1.9',
        agentAddr: '192.168.1.5',
        generic: 6,
        specific: 3,
        upTime: 1234,
        varbinds: [],
        ...fields,
    };
}

describe('trapOid', () => {
    it('takes the oid of snmpTrapOID.0 for v2c', () => {
        assert.strictEqual(trapOid(trapV2('1.3.6.1.6.3.1.1.5.3')), '1.3.6.1.6.3.1.1.5.3');
    });

    it('numbers the six generic traps of v1 the way RFC 3584 does', () => {
        // coldStart(0) -> .1 ... egpNeighborLoss(5) -> .6
        assert.strictEqual(trapOid(trapV1({ generic: 0 })), '1.3.6.1.6.3.1.1.5.1');
        assert.strictEqual(trapOid(trapV1({ generic: 2 })), '1.3.6.1.6.3.1.1.5.3', 'linkDown');
        assert.strictEqual(trapOid(trapV1({ generic: 5 })), '1.3.6.1.6.3.1.1.5.6');
    });

    it('builds <enterprise>.0.<specific> for an enterprise specific v1 trap', () => {
        assert.strictEqual(trapOid(trapV1({ generic: 6, specific: 3 })), '1.3.6.1.4.1.9.0.3');
        assert.strictEqual(trapOid(trapV1({ enterprise: '.1.3.6.1.4.1.9' })), '1.3.6.1.4.1.9.0.3', 'leading dot');
    });

    it('reports no oid when the notification names none', () => {
        assert.strictEqual(trapOid(trapV1({ generic: 6, enterprise: '' })), '');
        assert.strictEqual(trapOid({ type: snmp.PduType.TrapV2, varbinds: [] }), '');
        assert.strictEqual(trapOid({}), '');
    });

    it('reads an inform like a v2c trap', () => {
        const inform = { ...trapV2('1.3.6.1.4.1.8072.2.3.0.1'), type: snmp.PduType.InformRequest };
        assert.strictEqual(trapOid(inform), '1.3.6.1.4.1.8072.2.3.0.1');
    });
});

describe('trapVersion', () => {
    it('separates the versions by what the sender identified itself with', () => {
        assert.strictEqual(trapVersion(trapV1({})), 1);
        assert.strictEqual(trapVersion(trapV2('1.2.3')), 2);
        assert.strictEqual(trapVersion({ type: snmp.PduType.TrapV2, user: 'monitor' }), 3);
        assert.strictEqual(trapVersion({ type: snmp.PduType.InformRequest }), 2);
    });
});

describe('trapUpTime', () => {
    it('takes the pdu field of a v1 trap', () => {
        assert.strictEqual(trapUpTime(trapV1({ upTime: 99 })), 99);
    });

    it('takes the sysUpTime.0 varbind of a v2c trap', () => {
        assert.strictEqual(trapUpTime(trapV2('1.2.3')), 4242);
    });

    it('reports nothing when the notification carries no uptime', () => {
        assert.strictEqual(trapUpTime({ type: snmp.PduType.TrapV2, varbinds: [] }), undefined);
    });
});

describe('trapSender and trapIsInform', () => {
    it('names the community resp. the v3 user', () => {
        assert.strictEqual(trapSender(trapV2('1.2.3')), 'public');
        assert.strictEqual(trapSender({ user: 'monitor' }), 'monitor');
        assert.strictEqual(trapSender({}), '');
    });

    it('recognizes an inform, which has been acknowledged already', () => {
        assert.strictEqual(trapIsInform({ type: snmp.PduType.InformRequest }), true);
        assert.strictEqual(trapIsInform(trapV2('1.2.3')), false);
        assert.strictEqual(trapIsInform(trapV1({})), false);
    });
});

describe('deviceForTrapAddress', () => {
    const devices = [
        { id: 'switch', ipAddr: '192.168.1.2' },
        { id: 'printer', ipAddr: '192.168.1.7' },
    ];

    it('takes the device the notification came from', () => {
        assert.strictEqual(deviceForTrapAddress(devices, '192.168.1.7', '')?.id, 'printer');
    });

    it('sees through the IPv4 mapping of an IPv6 socket', () => {
        assert.strictEqual(deviceForTrapAddress(devices, '::ffff:192.168.1.2', '')?.id, 'switch');
    });

    it('falls back to the agent address a relayed v1 trap reports', () => {
        assert.strictEqual(deviceForTrapAddress(devices, '192.168.1.99', '192.168.1.2')?.id, 'switch');
    });

    it('reports nothing for an address no device uses', () => {
        assert.strictEqual(deviceForTrapAddress(devices, '127.0.0.1', ''), undefined);
        assert.strictEqual(deviceForTrapAddress(devices, '127.0.0.1', '10.0.0.1'), undefined);
        assert.strictEqual(deviceForTrapAddress([], '192.168.1.2', ''), undefined);
    });
});

describe('normalizeTrapAddress', () => {
    it('drops the IPv4 mapping an IPv6 socket reports', () => {
        assert.strictEqual(normalizeTrapAddress('::ffff:192.168.1.5'), '192.168.1.5');
        assert.strictEqual(normalizeTrapAddress('::FFFF:192.168.1.5'), '192.168.1.5');
    });

    it('leaves a plain address alone', () => {
        assert.strictEqual(normalizeTrapAddress(' 192.168.1.5 '), '192.168.1.5');
        assert.strictEqual(normalizeTrapAddress('fe80::1'), 'fe80::1');
        assert.strictEqual(normalizeTrapAddress(''), '');
    });
});
