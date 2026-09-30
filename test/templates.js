'use strict';

/*
 * Unit tests for the template logic (src-admin/src/types.ts) and for the templates which are
 * delivered with the adapter - a broken one there would reach every user.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    buildTemplate,
    importTemplate,
    oidGroups,
    parseTemplate,
    templateRows,
    TEMPLATE_FORMAT,
} = require('../src-admin/src/types.ts');

/** rows of the OID table, two groups */
const rows = [
    { oidAct: true, oidGroup: 'printer', oidName: 'pages', oidOid: '1.2.3.1', oidFormat: 1, oidWriteable: false, oidOptional: false },
    { oidAct: true, oidGroup: 'printer', oidName: 'toner', oidOid: '1.2.3.2', oidFormat: 1, oidWriteable: false, oidOptional: true },
    { oidAct: true, oidGroup: 'switch', oidName: 'ports', oidOid: '1.2.4.1', oidFormat: 1, oidWriteable: false, oidOptional: false },
];

describe('buildTemplate', () => {
    it('takes the oids of one group and leaves the group itself out', () => {
        const template = buildTemplate(rows, 'printer', 'Brother HL-L2350DW');

        assert.strictEqual(template.format, TEMPLATE_FORMAT);
        assert.strictEqual(template.name, 'Brother HL-L2350DW');
        assert.deepStrictEqual(
            template.oids.map(oid => oid.oidName),
            ['pages', 'toner'],
        );
        assert.ok(!('oidGroup' in template.oids[0]), 'the group belongs to the installation, not to the template');
        assert.strictEqual(template.oids[1].oidOptional, true, 'the flags of a row are kept');
    });

    it('falls back to the group name when no name is given', () => {
        assert.strictEqual(buildTemplate(rows, 'printer', '   ').name, 'printer');
    });

    it('produces an empty template for a group without oids', () => {
        assert.deepStrictEqual(buildTemplate(rows, 'nosuchgroup', 'x').oids, []);
    });
});

describe('parseTemplate', () => {
    const good = JSON.stringify(buildTemplate(rows, 'printer', 'printer'));

    it('reads a template the adapter wrote itself', () => {
        const { template, error } = parseTemplate(good);
        assert.strictEqual(error, undefined);
        assert.strictEqual(template.oids.length, 2);
    });

    it('names the reason why a file cannot be used', () => {
        assert.ok(parseTemplate('no json at all').error, 'broken json is reported');
        assert.strictEqual(parseTemplate('{"format":"something"}').error, 'notATemplate');
        assert.strictEqual(parseTemplate(`{"format":"${TEMPLATE_FORMAT}","name":"x","oids":[]}`).error, 'noOids');
        assert.strictEqual(
            parseTemplate(`{"format":"${TEMPLATE_FORMAT}","oids":[{"oidName":"a","oidOid":"1.2"}]}`).error,
            'noName',
        );
        assert.strictEqual(
            parseTemplate(`{"format":"${TEMPLATE_FORMAT}","name":"x","oids":[{"oidName":"a"}]}`).error,
            'incompleteOid',
        );
    });
});

describe('templateRows and importTemplate', () => {
    const template = buildTemplate(rows, 'printer', 'printer');

    it('builds active rows for the chosen group', () => {
        const imported = templateRows(template, ' office ');
        assert.strictEqual(imported.length, 2);
        assert.strictEqual(imported[0].oidGroup, 'office', 'the group is trimmed');
        assert.strictEqual(imported[0].oidAct, true);
    });

    it('uses the automatic format when a template does not say', () => {
        const withoutFormat = { ...template, oids: [{ oidName: 'a', oidOid: '1.2', oidWriteable: false, oidOptional: false }] };
        assert.strictEqual(templateRows(withoutFormat, 'g')[0].oidFormat, 99);
    });

    it('adds to a group without touching the other groups', () => {
        const result = importTemplate(rows, template, 'switch', false);
        assert.strictEqual(result.length, rows.length + 2);
        assert.strictEqual(result.filter(row => row.oidGroup === 'printer').length, 2, 'the other group stays');
        assert.strictEqual(result.filter(row => row.oidGroup === 'switch').length, 3, 'one existing plus two new');
    });

    it('replaces the rows of the group when asked to', () => {
        const result = importTemplate(rows, template, 'switch', true);
        assert.strictEqual(result.filter(row => row.oidGroup === 'switch').length, 2, 'only the new ones');
        assert.strictEqual(result.filter(row => row.oidGroup === 'printer').length, 2);
    });

    it('does not modify the table it was given', () => {
        const before = JSON.stringify(rows);
        importTemplate(rows, template, 'switch', true);
        assert.strictEqual(JSON.stringify(rows), before);
    });
});

describe('oidGroups', () => {
    it('collects the groups of both tables, sorted and without duplicates', () => {
        const devices = [{ devName: 'a', devOidGroup: 'switch' }, { devName: 'b', devOidGroup: 'new group' }];
        assert.deepStrictEqual(oidGroups(rows, devices), ['new group', 'printer', 'switch']);
    });

    it('survives empty tables', () => {
        assert.deepStrictEqual(oidGroups(undefined, undefined), []);
        assert.deepStrictEqual(oidGroups([{ oidGroup: '  ' }], [{ devOidGroup: '' }]), []);
    });
});

describe('the templates delivered with the adapter', () => {
    const dir = path.join(__dirname, '..', 'admin', 'templates');
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));

    it('lists files which exist', () => {
        assert.ok(index.templates.length, 'the index names at least one template');
        for (const file of index.templates) {
            assert.ok(fs.existsSync(path.join(dir, file)), `${file} is listed but missing`);
        }
    });

    it('delivers only templates the adapter can read', () => {
        for (const file of index.templates) {
            const { template, error } = parseTemplate(fs.readFileSync(path.join(dir, file), 'utf8'));
            assert.strictEqual(error, undefined, `${file}: ${error}`);
            assert.ok(template.description, `${file} should say what it is good for`);

            const names = new Set();
            for (const oid of template.oids) {
                assert.match(oid.oidOid, /^\d+(\.\d+)*$/, `${file}: ${oid.oidName} must be a numeric oid`);
                // the formats of src/lib/constants.ts - a typo here would reach every user
                assert.ok([0, 1, 2, 3, 4, 99].includes(oid.oidFormat), `${file}: ${oid.oidName} has an unknown format`);
                assert.ok(!names.has(oid.oidName), `${file}: ${oid.oidName} appears twice`);
                names.add(oid.oidName);
            }
        }
    });
});
