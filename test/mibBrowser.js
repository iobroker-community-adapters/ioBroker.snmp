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

const { buildOidRow, collectOids, filterTree, matchesFilter, suggestGroup } = require('../src-admin/src/types.ts');

/** a node as the backend delivers it */
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
        ...overrides,
    };
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

    it('omits the instance suffix for a node without one', () => {
        const row = buildOidRow(node({ name: 'ifNumber', symbol: 'IF-MIB::ifNumber' }), 'net', true);
        assert.strictEqual(row.oidName, 'ifNumber');
        assert.strictEqual(row.oidOid, 'IF-MIB::ifNumber');
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

describe('collectOids', () => {
    it('returns the oids of the whole tree, parents first', () => {
        const tree = [
            {
                ...node({ oid: '1.2' }),
                children: [node({ oid: '1.2.3' }), { ...node({ oid: '1.2.4' }), children: [node({ oid: '1.2.4.5' })] }],
            },
        ];
        assert.deepStrictEqual(collectOids(tree), ['1.2', '1.2.3', '1.2.4', '1.2.4.5']);
    });

    it('returns an empty list for an empty tree', () => {
        assert.deepStrictEqual(collectOids([]), []);
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
        assert.strictEqual(row.oidOid, 'TEST-SNMP-MIB::testCounter');
        assert.strictEqual(store.resolve(row.oidOid).oid, counter.oid);
    });

    it('a numeric row built from a tree node resolves back to the same oid', () => {
        const scalars = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testScalars');
        const counter = scalars.children.find(n => n.name === 'testCounter');

        const row = buildOidRow(counter, 'grp', false);
        assert.strictEqual(store.resolve(row.oidOid).oid, counter.oid);
    });

    it('a row built from a walk result keeps the instance and resolves back', () => {
        const walk = store.describeWalkResult([
            { oid: '1.3.6.1.4.1.99999.2.1.2.7', value: 'row seven', type: 'OctetString' },
        ]);
        const leaves = [];
        const collect = nodes => nodes.forEach(n => (n.children ? collect(n.children) : leaves.push(n)));
        collect(walk);

        assert.strictEqual(leaves.length, 1);
        const row = buildOidRow(leaves[0], 'grp', true);
        assert.strictEqual(row.oidOid, 'TEST-SNMP-MIB::testName.7');
        assert.strictEqual(row.oidName, 'testName.7');
        assert.strictEqual(store.resolve(row.oidOid).oid, '1.3.6.1.4.1.99999.2.1.2.7');
    });

    it('the state id the adapter derives matches the name the component stored', () => {
        const walk = store.describeWalkResult([
            { oid: '1.3.6.1.4.1.99999.2.1.2.7', value: 'row seven', type: 'OctetString' },
        ]);
        const leaves = [];
        const collect = nodes => nodes.forEach(n => (n.children ? collect(n.children) : leaves.push(n)));
        collect(walk);

        const row = buildOidRow(leaves[0], 'grp', true);
        assert.strictEqual(store.stateIdFor(row.oidOid), row.oidName);
    });

    it('a writeable MIB object produces a writeable row', () => {
        const scalars = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testScalars');
        const sw = scalars.children.find(n => n.name === 'testSwitch');
        assert.strictEqual(buildOidRow(sw, 'grp', true).oidWriteable, true);
    });
});
