'use strict';

/*
 * Unit tests for the pure logic of the admin MIB browser component
 * (src-admin/src/types.ts).
 *
 * The component itself only renders; everything that decides *what* is rendered and what ends up in
 * the OID table lives in these functions, so they are the part worth testing. The TypeScript source
 * is loaded directly through tsx - see the `test:unit` script.
 */

const assert = require('node:assert');

const {
    addableNodes,
    buildDeviceRow,
    buildOidRow,
    DEFAULT_WIZARD_DEVICE,
    deviceIssues,
    deviceOptions,
    filterTree,
    findNode,
    insertChildren,
    isConfigured,
    matchesFilter,
    pickNodes,
    suggestGroup,
} = require('../src-admin/src/types.ts');

/** a node as the backend delivers it - ifDescr is a column of ifTable */
function node(overrides) {
    return {
        symbol: 'IF-MIB::ifDescr',
        name: 'ifDescr',
        oid: '1.3.6.1.2.1.2.2.1.2',
        module: 'IF-MIB',
        syntax: 'DisplayString',
        access: 'read-only',
        readable: true,
        writeable: false,
        column: true,
        ...overrides,
    };
}

/** a scalar, which is read at ".0" */
function scalar(overrides) {
    return node({
        symbol: 'IF-MIB::ifNumber',
        name: 'ifNumber',
        oid: '1.3.6.1.2.1.2.1',
        syntax: 'Integer32',
        column: false,
        ...overrides,
    });
}

describe('buildOidRow', () => {
    it('stores the symbolic name when the MIB name option is active', () => {
        assert.deepStrictEqual(buildOidRow(node({ instance: '3' }), 'net', true), {
            oidAct: true,
            oidGroup: 'net',
            oidName: 'ifDescr.3',
            oidOid: 'IF-MIB::ifDescr.3',
            oidFormat: 99,
            oidWriteable: false,
            oidOptional: false,
        });
    });

    it('stores the numeric oid when the MIB name option is off', () => {
        const row = buildOidRow(node({ instance: '3', oid: '1.3.6.1.2.1.2.2.1.2.3' }), 'net', false);
        assert.strictEqual(row.oidOid, '1.3.6.1.2.1.2.2.1.2.3');
        assert.strictEqual(row.oidName, 'ifDescr.3', 'the name always comes from the MIB symbol');
    });

    it('reads a scalar at ".0" but keeps that out of the name', () => {
        const row = buildOidRow(scalar(), 'net', true);
        assert.strictEqual(row.oidName, 'ifNumber');
        assert.strictEqual(row.oidOid, 'IF-MIB::ifNumber.0');

        const numeric = buildOidRow(scalar(), 'net', false);
        assert.strictEqual(numeric.oidOid, '1.3.6.1.2.1.2.1.0');
    });

    it('leaves a column of a table without an instance - only the device knows the rows', () => {
        const row = buildOidRow(node(), 'net', true);
        assert.strictEqual(row.oidName, 'ifDescr');
        assert.strictEqual(row.oidOid, 'IF-MIB::ifDescr');
    });

    it('keeps the instance a live read delivered, including the ".0" of a scalar', () => {
        assert.strictEqual(buildOidRow(scalar({ instance: '0' }), 'net', true).oidOid, 'IF-MIB::ifNumber.0');
        assert.strictEqual(buildOidRow(scalar({ instance: '0' }), 'net', true).oidName, 'ifNumber');
        assert.strictEqual(buildOidRow(node({ instance: '3' }), 'net', true).oidName, 'ifDescr.3');
    });

    it('falls back to the numeric oid for a node without a symbol, even with the option on', () => {
        const row = buildOidRow(node({ symbol: '', name: '5', oid: '1.2.3.4.5' }), 'net', true);
        assert.strictEqual(row.oidOid, '1.2.3.4.5');
        assert.strictEqual(row.oidName, '5');
    });

    it('takes the writeable flag over from the MIB', () => {
        assert.strictEqual(buildOidRow(node({ writeable: true }), 'net', true).oidWriteable, true);
    });

    it('always uses the automatic format, so the state type follows the snmp type', () => {
        assert.strictEqual(buildOidRow(node(), 'net', true).oidFormat, 99);
    });

    it('puts the row into the given group and activates it', () => {
        const row = buildOidRow(node(), 'my group', true);
        assert.strictEqual(row.oidGroup, 'my group');
        assert.strictEqual(row.oidAct, true);
    });
});

describe('matchesFilter', () => {
    it('matches on the object name, case insensitively', () => {
        assert.strictEqual(matchesFilter(node(), 'ifdescr'), true);
        assert.strictEqual(matchesFilter(node(), 'descr'), true);
    });

    it('matches on the module qualified symbol', () => {
        assert.strictEqual(matchesFilter(node(), 'if-mib'), true);
    });

    it('matches on a part of the oid', () => {
        assert.strictEqual(matchesFilter(node(), '2.2.1.2'), true);
    });

    it('does not match something unrelated', () => {
        assert.strictEqual(matchesFilter(node(), 'sysdescr'), false);
    });

    it('matches everything when the filter is empty', () => {
        assert.strictEqual(matchesFilter(node(), ''), true);
    });
});

describe('filterTree', () => {
    const tree = [
        {
            ...node({ symbol: 'IF-MIB::interfaces', name: 'interfaces', oid: '1.3.6.1.2.1.2', readable: false }),
            children: [
                node({ symbol: 'IF-MIB::ifNumber', name: 'ifNumber', oid: '1.3.6.1.2.1.2.1' }),
                {
                    ...node({ symbol: 'IF-MIB::ifTable', name: 'ifTable', oid: '1.3.6.1.2.1.2.2', readable: false }),
                    children: [node()],
                },
            ],
        },
    ];

    it('returns the tree unchanged for an empty filter', () => {
        assert.strictEqual(filterTree(tree, ''), tree);
        assert.strictEqual(filterTree(tree, '   '), tree);
    });

    it('keeps a matching leaf together with the path to it', () => {
        const result = filterTree(tree, 'ifDescr');
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'interfaces');
        assert.strictEqual(result[0].children.length, 1);
        assert.strictEqual(result[0].children[0].name, 'ifTable');
        assert.strictEqual(result[0].children[0].children[0].name, 'ifDescr');
    });

    it('keeps a matching parent but drops its non matching children', () => {
        const result = filterTree(tree, 'interfaces');
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].children, undefined);
    });

    it('returns an empty tree when nothing matches', () => {
        assert.deepStrictEqual(filterTree(tree, 'nothingHere'), []);
    });

    it('does not modify the input tree', () => {
        const before = JSON.stringify(tree);
        filterTree(tree, 'ifNumber');
        assert.strictEqual(JSON.stringify(tree), before);
    });
});

describe('suggestGroup', () => {
    it('uses the group of the last configured row', () => {
        assert.strictEqual(suggestGroup([{ oidGroup: 'first' }, { oidGroup: 'last' }]), 'last');
    });

    it('skips rows without a group', () => {
        assert.strictEqual(suggestGroup([{ oidGroup: 'first' }, { oidGroup: '' }]), 'first');
    });

    it('falls back to "default" for an empty or missing table', () => {
        assert.strictEqual(suggestGroup([]), 'default');
        assert.strictEqual(suggestGroup(undefined), 'default');
        assert.strictEqual(suggestGroup([{}]), 'default');
    });
});

describe('deviceOptions', () => {
    it('offers every named device with its oid group', () => {
        assert.deepStrictEqual(
            deviceOptions([
                { devName: 'printer', devIpAddr: '10.0.0.5', devOidGroup: ' paper ' },
                { devName: 'switch', devIpAddr: '10.0.0.6:1161', devOidGroup: 'net' },
            ]),
            [
                { value: 'printer', label: 'printer (10.0.0.5)', group: 'paper' },
                { value: 'switch', label: 'switch (10.0.0.6:1161)', group: 'net' },
            ],
        );
    });

    it('skips a row which has just been created', () => {
        assert.deepStrictEqual(deviceOptions([{ devName: '', devIpAddr: '0.0.0.0', devOidGroup: 'default' }]), []);
    });

    it('accepts a device without an address or a group', () => {
        assert.deepStrictEqual(deviceOptions([{ devName: 'ups' }]), [
            { value: 'ups', label: 'ups', group: '' },
        ]);
    });

    it('survives an empty or missing table', () => {
        assert.deepStrictEqual(deviceOptions([]), []);
        assert.deepStrictEqual(deviceOptions(undefined), []);
    });
});

describe('isConfigured', () => {
    const rows = [
        { oidGroup: 'net', oidOid: '1.3.6.1.2.1.2.2.1.2' },
        { oidGroup: 'other', oidOid: '1.3.6.1.2.1.1.5.0' },
    ];

    it('finds a numeric oid of the same group', () => {
        assert.strictEqual(isConfigured(node(), rows, 'net', false), true);
    });

    it('ignores the same oid in another group', () => {
        assert.strictEqual(isConfigured(node({ oid: '1.3.6.1.2.1.1.5.0' }), rows, 'net', false), false);
    });

    it('compares the symbolic name when the MIB name option is active', () => {
        const symbolic = [{ oidGroup: 'net', oidOid: 'IF-MIB::ifDescr.3' }];
        assert.strictEqual(isConfigured(node({ instance: '3' }), symbolic, 'net', true), true);
        assert.strictEqual(isConfigured(node({ instance: '3' }), symbolic, 'net', false), false);
    });

    it('survives an empty table', () => {
        assert.strictEqual(isConfigured(node(), undefined, 'net', false), false);
        assert.strictEqual(isConfigured(node(), [], 'net', false), false);
    });
});

describe('addableNodes', () => {
    const tree = [
        node({
            name: 'ifTable',
            oid: '1.3.6.1.2.1.2.2',
            readable: false,
            children: [
                node({ name: 'ifDescr', oid: '1.3.6.1.2.1.2.2.1.2' }),
                node({ name: 'ifSpeed', oid: '1.3.6.1.2.1.2.2.1.5' }),
            ],
        }),
    ];

    it('offers the readable nodes of the whole tree', () => {
        const nodes = addableNodes(tree, [], 'net', false);
        assert.deepStrictEqual(
            nodes.map(entry => entry.name),
            ['ifDescr', 'ifSpeed'],
        );
    });

    it('leaves out what the group already contains', () => {
        const nodes = addableNodes(tree, [{ oidGroup: 'net', oidOid: '1.3.6.1.2.1.2.2.1.2' }], 'net', false);
        assert.deepStrictEqual(
            nodes.map(entry => entry.name),
            ['ifSpeed'],
        );
    });

    it('returns an empty list for an empty tree', () => {
        assert.deepStrictEqual(addableNodes([], [], 'net', false), []);
    });
});

describe('buildDeviceRow', () => {
    const device = { ...DEFAULT_WIZARD_DEVICE, name: 'printer', ipAddr: '10.0.0.5', authId: 'public' };

    it('builds a complete row with the defaults of the device table', () => {
        assert.deepStrictEqual(buildDeviceRow(device), {
            devAct: true,
            devName: 'printer',
            devIpAddr: '10.0.0.5',
            devIp6: false,
            devOidGroup: 'printer',
            devSnmpVers: 1,
            devAuthId: 'public',
            devTimeout: 5,
            devRetryIntvl: 5,
            devPollIntvl: 30,
        });
    });

    it('names the group after the device if none was given', () => {
        assert.strictEqual(buildDeviceRow({ ...device, group: '' }).devOidGroup, 'printer');
        assert.strictEqual(buildDeviceRow({ ...device, group: ' shared ' }).devOidGroup, 'shared');
    });

    it('trims the name and the address', () => {
        const row = buildDeviceRow({ ...device, name: ' printer ', ipAddr: ' 10.0.0.5 ' });
        assert.strictEqual(row.devName, 'printer');
        assert.strictEqual(row.devIpAddr, '10.0.0.5');
    });
});

describe('deviceIssues', () => {
    const device = { ...DEFAULT_WIZARD_DEVICE, name: 'printer', ipAddr: '10.0.0.5' };

    it('accepts a complete device', () => {
        assert.deepStrictEqual(deviceIssues(device, []), []);
        assert.deepStrictEqual(deviceIssues(device, undefined), []);
    });

    it('reports a missing name and a missing address', () => {
        assert.deepStrictEqual(deviceIssues({ ...device, name: '  ' }, []), ['name']);
        assert.deepStrictEqual(deviceIssues({ ...device, ipAddr: '' }, []), ['ip']);
        assert.deepStrictEqual(deviceIssues({ ...device, ipAddr: '0.0.0.0' }, []), ['ip']);
    });

    it('reports a name the adapter cannot build object ids from', () => {
        assert.deepStrictEqual(deviceIssues({ ...device, name: 'printer.' }, []), ['nameInvalid']);
        assert.deepStrictEqual(deviceIssues({ ...device, name: 'a..b' }, []), ['nameInvalid']);
    });

    it('reports a name which is already in use', () => {
        assert.deepStrictEqual(deviceIssues(device, [{ devName: 'printer' }]), ['duplicate']);
        assert.deepStrictEqual(deviceIssues(device, [{ devName: 'other' }]), []);
    });
});

describe('pickNodes', () => {
    const tree = [
        node({
            name: 'ifTable',
            oid: '1.3.6.1.2.1.2.2',
            readable: false,
            children: [
                node({ name: 'ifDescr', oid: '1.3.6.1.2.1.2.2.1.2' }),
                node({ name: 'ifSpeed', oid: '1.3.6.1.2.1.2.2.1.5' }),
            ],
        }),
    ];

    it('returns the selected nodes in the order of the tree', () => {
        const nodes = pickNodes(tree, ['1.3.6.1.2.1.2.2.1.5', '1.3.6.1.2.1.2.2.1.2']);
        assert.deepStrictEqual(
            nodes.map(entry => entry.name),
            ['ifDescr', 'ifSpeed'],
        );
    });

    it('ignores an oid which is not part of the tree', () => {
        assert.deepStrictEqual(pickNodes(tree, ['1.2.3']), []);
        assert.deepStrictEqual(pickNodes(tree, []), []);
    });
});

describe('findNode', () => {
    const tree = [
        node({
            name: 'ifTable',
            oid: '1.3.6.1.2.1.2.2',
            children: [node({ oid: '1.3.6.1.2.1.2.2.1.2' })],
        }),
    ];

    it('finds a node at any depth', () => {
        assert.strictEqual(findNode(tree, '1.3.6.1.2.1.2.2').name, 'ifTable');
        assert.strictEqual(findNode(tree, '1.3.6.1.2.1.2.2.1.2').name, 'ifDescr');
    });

    it('returns null for an oid the tree does not contain', () => {
        assert.strictEqual(findNode(tree, '1.2.3'), null);
        assert.strictEqual(findNode([], '1.2.3'), null);
    });
});

describe('insertChildren', () => {
    const tree = [
        node({ name: 'system', oid: '1.3.6.1.2.1.1', hasChildren: true, children: undefined }),
        node({ name: 'interfaces', oid: '1.3.6.1.2.1.2', hasChildren: true, children: undefined }),
    ];

    it('fills the folder which has been opened', () => {
        const filled = insertChildren(tree, '1.3.6.1.2.1.2', [node({ oid: '1.3.6.1.2.1.2.1', name: 'ifNumber' })]);
        assert.deepStrictEqual(
            filled[1].children.map(n => n.name),
            ['ifNumber'],
        );
        assert.strictEqual(filled[0].children, undefined, 'the other folders stay untouched');
    });

    it('marks an empty folder as read, so that it is not asked for again', () => {
        const filled = insertChildren(tree, '1.3.6.1.2.1.1', []);
        assert.deepStrictEqual(filled[0].children, []);
        assert.strictEqual(filled[0].hasChildren, false);
    });

    it('fills a folder below an already opened one', () => {
        const opened = insertChildren(tree, '1.3.6.1.2.1.2', [
            node({ oid: '1.3.6.1.2.1.2.2', name: 'ifTable', hasChildren: true, children: undefined }),
        ]);
        const deeper = insertChildren(opened, '1.3.6.1.2.1.2.2', [node({ oid: '1.3.6.1.2.1.2.2.1', name: 'ifEntry' })]);

        assert.deepStrictEqual(
            deeper[1].children[0].children.map(n => n.name),
            ['ifEntry'],
        );
    });

    it('does not modify the tree it was given', () => {
        const before = JSON.stringify(tree);
        insertChildren(tree, '1.3.6.1.2.1.2', [node({ oid: '1.3.6.1.2.1.2.1' })]);
        assert.strictEqual(JSON.stringify(tree), before);
    });
});

describe('contract between the backend and the component', () => {
    /*
     * src/lib/mibTypes.ts and src-admin/src/types.ts describe the same sendTo payload but are two
     * separate files. These tests take a node the real MibStore produced, run it through the
     * component's row builder and let the backend resolve the result again - if the two drift apart,
     * this breaks.
     */
    const { copyFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const path = require('node:path');
    const { MibStore } = require('../build/lib/mib');

    let dataDir;
    let store;

    before(() => {
        dataDir = mkdtempSync(path.join(tmpdir(), 'iob-snmp-contract-'));
        store = new MibStore({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }, dataDir);
        mkdirSync(store.directory, { recursive: true });
        copyFileSync(
            path.join(__dirname, 'mibs', 'TEST-SNMP-MIB.mib'),
            path.join(store.directory, 'TEST-SNMP-MIB.mib'),
        );
        store.load();
    });

    after(() => rmSync(dataDir, { recursive: true, force: true }));

    it('a symbolic row built from a tree node resolves back to the same oid', () => {
        const scalars = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testScalars');
        const counter = scalars.children.find(n => n.name === 'testCounter');

        const row = buildOidRow(counter, 'grp', true);
        assert.strictEqual(row.oidOid, 'TEST-SNMP-MIB::testCounter.0');
        assert.strictEqual(store.resolve(row.oidOid).oid, `${counter.oid}.0`);
        assert.strictEqual(store.stateIdFor(row.oidOid), 'testCounter', 'the ".0" stays out of the state id');
    });

    it('a numeric row built from a tree node resolves back to the same oid', () => {
        const scalars = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testScalars');
        const counter = scalars.children.find(n => n.name === 'testCounter');

        const row = buildOidRow(counter, 'grp', false);
        assert.strictEqual(store.resolve(row.oidOid).oid, `${counter.oid}.0`);
    });

    it('a row built from a value read live keeps the instance and resolves back', () => {
        const read = store.nodeForVarbind({
            oid: '1.3.6.1.4.1.99999.2.1.2.7',
            value: 'row seven',
            type: 'OctetString',
        });

        const row = buildOidRow(read, 'grp', true);
        assert.strictEqual(row.oidOid, 'TEST-SNMP-MIB::testName.7');
        assert.strictEqual(row.oidName, 'testName.7');
        assert.strictEqual(store.resolve(row.oidOid).oid, '1.3.6.1.4.1.99999.2.1.2.7');
    });

    it('the state id the adapter derives matches the name the component stored', () => {
        const read = store.nodeForVarbind({
            oid: '1.3.6.1.4.1.99999.2.1.2.7',
            value: 'row seven',
            type: 'OctetString',
        });

        const row = buildOidRow(read, 'grp', true);
        assert.strictEqual(store.stateIdFor(row.oidOid), row.oidName);
    });

    it('a writeable MIB object produces a writeable row', () => {
        const scalars = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testScalars');
        const sw = scalars.children.find(n => n.name === 'testSwitch');
        assert.strictEqual(buildOidRow(sw, 'grp', true).oidWriteable, true);
    });
});
