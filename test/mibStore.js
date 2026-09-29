'use strict';

/*
 * Unit tests for the MIB handling (src/lib/mib.ts).
 *
 * The tests run against build/, so `npm run build-backend` has to run first - the `test:unit`
 * script does that.
 */

const assert = require('node:assert');
const { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const {
    MibStore,
    MIB_SUB_DIR,
    buildTree,
    compareOids,
    isNumericOid,
    splitOidSpec,
    syntaxToText,
} = require('../build/lib/mib');

/** the MIBs net-snmp ships - used to test that IMPORTS between uploaded files are resolved */
const NET_SNMP_MIBS = path.join(__dirname, '..', 'node_modules', 'net-snmp', 'lib', 'mibs');
const FIXTURES = path.join(__dirname, 'mibs');

/** collects what the store logs so that the tests can assert on warnings */
function makeLog() {
    const entries = { debug: [], info: [], warn: [], error: [] };
    return {
        entries,
        debug: m => entries.debug.push(m),
        info: m => entries.info.push(m),
        warn: m => entries.warn.push(m),
        error: m => entries.error.push(m),
    };
}

describe('splitOidSpec', () => {
    it('leaves a numeric oid untouched - every sub identifier may belong to the oid', () => {
        assert.deepStrictEqual(splitOidSpec('1.3.6.1.2.1.1.5.0'), { base: '1.3.6.1.2.1.1.5.0', instance: '' });
    });

    it('strips a leading dot from a numeric oid', () => {
        assert.deepStrictEqual(splitOidSpec('.1.3.6.1'), { base: '1.3.6.1', instance: '' });
    });

    it('splits a module qualified symbol from its instance', () => {
        assert.deepStrictEqual(splitOidSpec('IF-MIB::ifDescr.1'), { base: 'IF-MIB::ifDescr', instance: '1' });
    });

    it('splits a bare symbol from a multi part instance', () => {
        assert.deepStrictEqual(splitOidSpec('ifDescr.1.2'), { base: 'ifDescr', instance: '1.2' });
    });

    it('accepts a symbol without an instance', () => {
        assert.deepStrictEqual(splitOidSpec('IF-MIB::ifNumber'), { base: 'IF-MIB::ifNumber', instance: '' });
    });

    it('accepts hyphens in module and object names', () => {
        assert.deepStrictEqual(splitOidSpec('MY-TEST-MIB::some-value.3'), {
            base: 'MY-TEST-MIB::some-value',
            instance: '3',
        });
    });

    it('trims the specification', () => {
        assert.deepStrictEqual(splitOidSpec('  IF-MIB::ifDescr.1  '), { base: 'IF-MIB::ifDescr', instance: '1' });
    });

    it('reports a malformed specification with an empty base', () => {
        for (const spec of ['', '   ', '::ifDescr', 'IF-MIB::', 'if Descr', 'ifDescr.a', '1.2.x', '$$$']) {
            assert.deepStrictEqual(splitOidSpec(spec), { base: '', instance: '' }, `for "${spec}"`);
        }
    });

    it('survives a missing argument', () => {
        assert.deepStrictEqual(splitOidSpec(undefined), { base: '', instance: '' });
    });
});

describe('isNumericOid', () => {
    it('accepts numeric oids with and without a leading dot', () => {
        assert.strictEqual(isNumericOid('1.3.6.1'), true);
        assert.strictEqual(isNumericOid('.1.3.6.1'), true);
        assert.strictEqual(isNumericOid('1'), true);
    });

    it('rejects everything else', () => {
        for (const spec of ['', 'ifDescr', 'IF-MIB::ifDescr', '1.3.6.1.', 'ifDescr.1']) {
            assert.strictEqual(isNumericOid(spec), false, `for "${spec}"`);
        }
    });
});

describe('syntaxToText', () => {
    it('returns a plain syntax name unchanged', () => {
        assert.strictEqual(syntaxToText('Integer32'), 'Integer32');
    });

    it('returns the name of a constrained syntax', () => {
        assert.strictEqual(syntaxToText({ DisplayString: { sizes: [{ min: 0, max: 255 }] } }), 'DisplayString');
    });

    it('returns an empty string for a missing syntax', () => {
        assert.strictEqual(syntaxToText(undefined), '');
        assert.strictEqual(syntaxToText(''), '');
    });
});

describe('compareOids', () => {
    it('compares sub identifier by sub identifier, numerically', () => {
        assert.ok(compareOids('1.3.6.1.2.1.2', '1.3.6.1.2.1.10') < 0, '2 must sort before 10');
        assert.ok(compareOids('1.3.6.1.2.1.10', '1.3.6.1.2.1.2') > 0);
        assert.strictEqual(compareOids('1.3.6.1', '1.3.6.1'), 0);
    });

    it('sorts a prefix before the oids below it', () => {
        assert.ok(compareOids('1.3.6.1', '1.3.6.1.1') < 0);
    });

    it('sorts a list the way a MIB browser displays it', () => {
        const oids = ['1.3.6.1.2.1.2.2', '1.3.6.1.2.1.2.1', '1.3.6.1.2.1.2.2.1.10', '1.3.6.1.2.1.2.2.1.2'];
        assert.deepStrictEqual(oids.sort(compareOids), [
            '1.3.6.1.2.1.2.1',
            '1.3.6.1.2.1.2.2',
            '1.3.6.1.2.1.2.2.1.2',
            '1.3.6.1.2.1.2.2.1.10',
        ]);
    });
});

describe('buildTree', () => {
    const node = (oid, name) => ({ symbol: `M::${name}`, name, oid, module: 'M', readable: true, writeable: false });

    it('nests a node below the longest matching prefix', () => {
        const tree = buildTree([node('1.2.3', 'c'), node('1.2', 'b'), node('1.2.3.4', 'd')]);
        assert.strictEqual(tree.length, 1);
        assert.strictEqual(tree[0].name, 'b');
        assert.strictEqual(tree[0].children.length, 1);
        assert.strictEqual(tree[0].children[0].name, 'c');
        assert.strictEqual(tree[0].children[0].children[0].name, 'd');
    });

    it('keeps nodes whose parent is not part of the list at the top level', () => {
        const tree = buildTree([node('1.2.3', 'a'), node('9.9', 'b')]);
        assert.deepStrictEqual(
            tree.map(n => n.name),
            ['a', 'b'],
        );
    });

    it('skips missing intermediate levels instead of inventing nodes', () => {
        const tree = buildTree([node('1', 'root'), node('1.2.3.4.5', 'deep')]);
        assert.strictEqual(tree.length, 1);
        assert.strictEqual(tree[0].children.length, 1);
        assert.strictEqual(tree[0].children[0].name, 'deep');
    });

    it('sorts children numerically', () => {
        const tree = buildTree([node('1', 'root'), node('1.10', 'ten'), node('1.2', 'two')]);
        assert.deepStrictEqual(
            tree[0].children.map(n => n.name),
            ['two', 'ten'],
        );
    });

    it('does not reuse the children array of the input nodes', () => {
        const input = [node('1', 'root'), node('1.2', 'child')];
        input[0].children = ['do not touch'];
        const tree = buildTree(input);
        assert.deepStrictEqual(input[0].children, ['do not touch']);
        assert.strictEqual(tree[0].children.length, 1);
        assert.strictEqual(tree[0].children[0].name, 'child');
    });

    it('returns an empty array for an empty input', () => {
        assert.deepStrictEqual(buildTree([]), []);
    });
});

describe('MibStore', () => {
    let dataDir;
    let store;
    let log;

    before(() => {
        dataDir = mkdtempSync(path.join(tmpdir(), 'iob-snmp-mib-'));
        log = makeLog();
        store = new MibStore(log, dataDir);
        store.writeFiles([
            { name: 'TEST-SNMP-MIB.mib', data: require('node:fs').readFileSync(path.join(FIXTURES, 'TEST-SNMP-MIB.mib')) },
            { name: 'IF-MIB.mib', data: require('node:fs').readFileSync(path.join(NET_SNMP_MIBS, 'IF-MIB.mib')) },
            {
                name: 'IANAifType-MIB.mib',
                data: require('node:fs').readFileSync(path.join(NET_SNMP_MIBS, 'IANAifType-MIB.mib')),
            },
        ]);
        store.load();
    });

    after(() => {
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('stores the MIB files in a sub directory of the instance data directory', () => {
        assert.strictEqual(store.directory, path.join(dataDir, MIB_SUB_DIR));
    });

    it('reports itself as loaded', () => {
        assert.strictEqual(store.loaded, true);
    });

    it('lists the uploaded modules before the built in ones', () => {
        const modules = store.getModules();
        const user = modules.filter(m => !m.base).map(m => m.name);
        assert.ok(user.includes('TEST-SNMP-MIB'), `uploaded modules: ${user.join(', ')}`);
        assert.ok(user.includes('IF-MIB'));
        assert.strictEqual(modules.findIndex(m => m.base) > user.length - 1, true);
        assert.ok(
            modules.some(m => m.base && m.name === 'SNMPv2-MIB'),
            'SNMPv2-MIB must be reported as a built in module',
        );
    });

    it('counts the symbols of a module', () => {
        const testMib = store.getModules().find(m => m.name === 'TEST-SNMP-MIB');
        // testSnmpMib, testScalars, testCounter, testSwitch, testTable, testEntry, testIndex, testName
        assert.strictEqual(testMib.symbols, 8);
    });

    it('resolves the IMPORTS between two uploaded files', () => {
        // IF-MIB imports IANAifType-MIB; both are uploaded, so the second pass has to fix it up
        assert.deepStrictEqual(store.getLoadErrors(), {});
        assert.ok(store.resolve('IF-MIB::ifType'), 'ifType uses a type from IANAifType-MIB');
    });

    describe('resolve', () => {
        it('resolves a module qualified symbol', () => {
            assert.deepStrictEqual(store.resolve('IF-MIB::ifDescr'), {
                oid: '1.3.6.1.2.1.2.2.1.2',
                symbol: 'IF-MIB::ifDescr',
                name: 'ifDescr',
                instance: '',
            });
        });

        it('appends the instance suffix to the resolved oid', () => {
            assert.deepStrictEqual(store.resolve('IF-MIB::ifDescr.3'), {
                oid: '1.3.6.1.2.1.2.2.1.2.3',
                symbol: 'IF-MIB::ifDescr',
                name: 'ifDescr',
                instance: '3',
            });
        });

        it('resolves a bare symbol without the module prefix', () => {
            assert.strictEqual(store.resolve('testSwitch').oid, '1.3.6.1.4.1.99999.1.2');
        });

        it('does not resolve a bare name against a different module prefix', () => {
            assert.strictEqual(store.resolve('NO-SUCH-MIB::ifDescr'), null);
        });

        it('reports the symbol of a numeric oid', () => {
            assert.deepStrictEqual(store.resolve('1.3.6.1.2.1.2.2.1.2.7'), {
                oid: '1.3.6.1.2.1.2.2.1.2.7',
                symbol: 'IF-MIB::ifDescr',
                name: 'ifDescr',
                instance: '7',
            });
        });

        it('passes a numeric oid no MIB covers through unchanged', () => {
            assert.deepStrictEqual(store.resolve('1.2.3.4.5'), {
                oid: '1.2.3.4.5',
                symbol: '',
                name: '',
                instance: '',
            });
        });

        it('returns null for an unknown symbol and for a malformed specification', () => {
            assert.strictEqual(store.resolve('noSuchObject'), null);
            assert.strictEqual(store.resolve('TEST-SNMP-MIB::noSuchObject'), null);
            assert.strictEqual(store.resolve('not a valid oid'), null);
            assert.strictEqual(store.resolve(''), null);
        });
    });

    describe('describe', () => {
        it('finds the longest known prefix and reports the rest as instance', () => {
            assert.deepStrictEqual(store.describe('1.3.6.1.2.1.2.2.1.2.42'), {
                oid: '1.3.6.1.2.1.2.2.1.2.42',
                symbol: 'IF-MIB::ifDescr',
                name: 'ifDescr',
                instance: '42',
            });
        });

        it('reports an exact match without an instance', () => {
            assert.strictEqual(store.describe('1.3.6.1.2.1.2.2.1.2').instance, '');
        });

        it('returns null for an oid outside of every loaded MIB', () => {
            assert.strictEqual(store.describe('2.999.1'), null);
        });

        it('returns null for a symbolic specification', () => {
            assert.strictEqual(store.describe('IF-MIB::ifDescr'), null);
        });
    });

    describe('stateIdFor', () => {
        it('uses the bare object name, without the module', () => {
            assert.strictEqual(store.stateIdFor('IF-MIB::ifNumber'), 'ifNumber');
        });

        it('appends the instance suffix', () => {
            assert.strictEqual(store.stateIdFor('IF-MIB::ifDescr.2'), 'ifDescr.2');
        });

        it('derives the id from a numeric oid too', () => {
            assert.strictEqual(store.stateIdFor('1.3.6.1.2.1.2.2.1.2.2'), 'ifDescr.2');
        });

        it('returns null when no MIB covers the oid, so that the caller can fall back to oidName', () => {
            assert.strictEqual(store.stateIdFor('1.2.3.4.5'), null);
            assert.strictEqual(store.stateIdFor('noSuchObject'), null);
        });

        it('drops the ".0" of a scalar - it addresses the value, it is not part of the object', () => {
            assert.strictEqual(store.stateIdFor('IF-MIB::ifNumber.0'), 'ifNumber');
            assert.strictEqual(store.stateIdFor('1.3.6.1.2.1.2.1.0'), 'ifNumber');
        });

        it('keeps the index 0 of a table, it is a row like any other', () => {
            assert.strictEqual(store.stateIdFor('IF-MIB::ifDescr.0'), 'ifDescr.0');
        });
    });

    describe('getTree', () => {
        it('builds the tree of a module starting at its own root', () => {
            const tree = store.getTree('TEST-SNMP-MIB');
            assert.strictEqual(tree.length, 1);
            assert.strictEqual(tree[0].symbol, 'TEST-SNMP-MIB::testSnmpMib');
            assert.strictEqual(tree[0].oid, '1.3.6.1.4.1.99999');
            assert.deepStrictEqual(
                tree[0].children.map(n => n.name),
                ['testScalars', 'testTable'],
            );
        });

        it('marks a scalar with an access clause as readable', () => {
            const scalars = store.getTree('TEST-SNMP-MIB')[0].children[0];
            const counter = scalars.children.find(n => n.name === 'testCounter');
            assert.strictEqual(counter.readable, true);
            assert.strictEqual(counter.writeable, false);
            assert.strictEqual(counter.syntax, 'Integer32');
            assert.strictEqual(counter.access, 'read-only');
            assert.strictEqual(counter.description, 'A read only counter.');
        });

        it('marks a column of a table, so that the browser can ask for the index of a row', () => {
            const table = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testTable');
            const name = table.children[0].children.find(n => n.name === 'testName');
            assert.strictEqual(name.column, true);

            const scalars = store.getTree('TEST-SNMP-MIB')[0].children[0];
            const counter = scalars.children.find(n => n.name === 'testCounter');
            assert.strictEqual(counter.column, false, 'a scalar is read at .0 instead');
        });

        it('marks a read-write object as writeable', () => {
            const scalars = store.getTree('TEST-SNMP-MIB')[0].children[0];
            const sw = scalars.children.find(n => n.name === 'testSwitch');
            assert.strictEqual(sw.readable, true);
            assert.strictEqual(sw.writeable, true);
        });

        it('does not offer a table or its entry for polling', () => {
            const table = store.getTree('TEST-SNMP-MIB')[0].children.find(n => n.name === 'testTable');
            assert.strictEqual(table.readable, false, 'SEQUENCE OF must not be pollable');
            assert.strictEqual(table.children[0].name, 'testEntry');
            assert.strictEqual(table.children[0].readable, false, 'not-accessible must not be pollable');
            assert.deepStrictEqual(
                table.children[0].children.map(n => n.name),
                ['testIndex', 'testName'],
            );
            assert.strictEqual(table.children[0].children[1].readable, true);
        });

        it('returns an empty array for an unknown module', () => {
            assert.deepStrictEqual(store.getTree('NO-SUCH-MIB'), []);
        });
    });

    describe('nodeForVarbind', () => {
        it('annotates a value read from the device with its MIB name and instance', () => {
            const node = store.nodeForVarbind({ oid: '1.3.6.1.2.1.2.2.1.2.1', value: 'lo', type: 'OctetString' });
            assert.strictEqual(node.name, 'ifDescr');
            assert.strictEqual(node.instance, '1');
            assert.strictEqual(node.symbol, 'IF-MIB::ifDescr');
            assert.strictEqual(node.oid, '1.3.6.1.2.1.2.2.1.2.1');
            assert.strictEqual(node.value, 'lo');
            assert.strictEqual(node.type, 'OctetString');
            assert.strictEqual(node.readable, true);
        });

        it('keeps an oid no MIB covers, using its last sub identifier as name', () => {
            const node = store.nodeForVarbind({ oid: '1.2.3.4.5', value: '7', type: 'Integer32' });
            assert.strictEqual(node.name, '5');
            assert.strictEqual(node.symbol, '');
            assert.strictEqual(node.value, '7');
            assert.strictEqual(node.readable, true, 'the device returned a value, so it is pollable');
        });
    });

    describe('nodeForFolder', () => {
        it('reports a node whose content has not been read yet', () => {
            const node = store.nodeForFolder('1.3.6.1.2.1.2.2');
            assert.strictEqual(node.name, 'ifTable');
            assert.strictEqual(node.hasChildren, true);
            assert.strictEqual(node.readable, false, 'the values sit in the rows, not in the table itself');
        });

        it('describes a folder no MIB covers by its oid', () => {
            const node = store.nodeForFolder('1.2.3.4');
            assert.strictEqual(node.name, '4');
            assert.strictEqual(node.hasChildren, true);
        });
    });
});

describe('MibStore without any uploaded MIB', () => {
    let dataDir;
    let store;

    before(() => {
        dataDir = mkdtempSync(path.join(tmpdir(), 'iob-snmp-mib-empty-'));
        store = new MibStore(makeLog(), dataDir);
        store.load();
    });

    after(() => rmSync(dataDir, { recursive: true, force: true }));

    it('still offers the built in modules', () => {
        assert.strictEqual(store.loaded, true);
        assert.strictEqual(
            store.getModules().every(m => m.base),
            true,
        );
        assert.strictEqual(store.resolve('SNMPv2-MIB::sysDescr').oid, '1.3.6.1.2.1.1.1');
    });

    it('resolves numeric oids without any MIB', () => {
        assert.strictEqual(store.resolve('1.2.3').oid, '1.2.3');
    });
});

describe('MibStore with a broken MIB file', () => {
    let dataDir;
    let store;
    let log;

    before(() => {
        dataDir = mkdtempSync(path.join(tmpdir(), 'iob-snmp-mib-broken-'));
        log = makeLog();
        store = new MibStore(log, dataDir);
        mkdirSync(store.directory, { recursive: true });
        writeFileSync(path.join(store.directory, 'BROKEN.mib'), 'this is not a MIB at all');
        copyFileSync(path.join(FIXTURES, 'TEST-SNMP-MIB.mib'), path.join(store.directory, 'TEST-SNMP-MIB.mib'));
        store.load();
    });

    after(() => rmSync(dataDir, { recursive: true, force: true }));

    it('reports the file as an error and warns about it', () => {
        assert.deepStrictEqual(Object.keys(store.getLoadErrors()), ['BROKEN.mib']);
        assert.ok(
            log.entries.warn.some(m => m.includes('BROKEN.mib')),
            `warnings: ${log.entries.warn.join(' | ')}`,
        );
    });

    it('loads the remaining files nevertheless', () => {
        assert.strictEqual(store.resolve('testCounter').oid, '1.3.6.1.4.1.99999.1.1');
    });
});

describe('MibStore.writeFiles', () => {
    let dataDir;

    before(() => (dataDir = mkdtempSync(path.join(tmpdir(), 'iob-snmp-mib-write-'))));
    after(() => rmSync(dataDir, { recursive: true, force: true }));

    it('replaces the whole directory, so deleted uploads disappear', () => {
        const store = new MibStore(makeLog(), dataDir);
        store.writeFiles([{ name: 'A.mib', data: 'x' }]);
        store.writeFiles([{ name: 'B.mib', data: 'y' }]);
        assert.deepStrictEqual(require('node:fs').readdirSync(store.directory).sort(), ['B.mib']);
    });

    it('does not let a file name escape the MIB directory', () => {
        const store = new MibStore(makeLog(), dataDir);
        store.writeFiles([{ name: '../escaped.mib', data: 'x' }]);
        assert.deepStrictEqual(require('node:fs').readdirSync(store.directory), ['.._escaped.mib']);
    });
});
