/**
 * Contract of the `mib*` sendTo commands of the snmp adapter.
 *
 * NOTE: this is a copy of src/lib/mibTypes.ts. The component is built as its own bundle and cannot
 * import from the adapter's build output, so both files have to be changed together.
 */

/** One entry of the MIB tree */
export interface MibTreeNode {
    /** module qualified symbol, e.g. "IF-MIB::ifDescr" - empty for nodes without a name */
    symbol: string;
    /** object name, e.g. "ifDescr", or the numeric sub identifier for unnamed nodes */
    name: string;
    /** numeric oid, e.g. "1.3.6.1.2.1.2.2.1.2" */
    oid: string;
    /** name of the MIB module this entry has been defined in */
    module: string;
    /** textual representation of the SYNTAX clause */
    syntax?: string;
    /** MAX-ACCESS resp. ACCESS clause */
    access?: string;
    /** DESCRIPTION clause */
    description?: string;
    /** true if the entry can hold a value and therefore can be polled */
    readable: boolean;
    /** true if the MIB declares the entry as writeable */
    writeable: boolean;
    /**
     * true if the entry is a column of a table
     *
     * Such an oid addresses a column, not a value: the index of the row has to be appended, and
     * only the device knows which rows exist. A scalar in contrast is always read at "<oid>.0".
     */
    column?: boolean;
    /** live walk only - instance suffix, e.g. "1" for ifDescr.1 */
    instance?: string;
    /** live walk only - value read from the device */
    value?: string;
    /** live walk only - textual snmp object type of the value read */
    type?: string;
    /**
     * true if the node has children which have not been read yet
     *
     * The live browser reads one level at a time, so a folder is reported before its content is
     * known - it is filled when the user opens it.
     */
    hasChildren?: boolean;
    children?: MibTreeNode[];
}

/** One loaded MIB module */
export interface MibModuleInfo {
    name: string;
    /** oid the module starts at - the browser jumps there */
    oid: string;
    /** number of entries with an oid */
    symbols: number;
    /** true for the modules net-snmp ships itself - those cannot be deleted */
    base: boolean;
}

/** Response of the `mibModules` command */
export interface MibModulesResponse {
    modules: MibModuleInfo[];
    /** files which could not be parsed, keyed by file name */
    errors: Record<string, string>;
    error?: string;
}

/** Response of the `mibNodes` and `mibChildren` commands */
export interface MibNodesResponse {
    nodes: MibTreeNode[];
    /** set if the request failed */
    error?: string;
    /** set if the answer has been cut off because the limit was reached */
    truncated?: boolean;
}

/**
 * One row of `native.devs` - the device table of the config dialog
 *
 * Only the two attributes the MIB browser reads and writes are named; everything else of a device is
 * passed through unchanged, so the row is kept as it is.
 */
export interface DeviceRow {
    devName: string;
    devOidGroup: string;
    devIpAddr?: string;
    [attribute: string]: unknown;
}

/** One entry of the device drop down of the MIB browser */
export interface DeviceOption {
    /** device name - identifies the device in a `mibChildren` request */
    value: string;
    /** name and ip address, for the drop down */
    label: string;
    /** oid group of the device - everything picked for this device is added to that group */
    group: string;
}

/**
 * deviceOptions - the devices the MIB browser offers
 *
 * The devices are taken from the dialog and not from the running instance, so that a device which
 * has just been entered can be equipped with oids right away, without saving and restarting first.
 * A row without a name is a row the user has just created and not filled in yet.
 *
 * @param pRows current content of the device table
 * @returns one entry per named device, in the order of the table
 */
export function deviceOptions(pRows: DeviceRow[] | undefined): DeviceOption[] {
    return (pRows || [])
        .filter(row => !!row?.devName)
        .map(row => ({
            value: row.devName,
            label: row.devIpAddr ? `${row.devName} (${row.devIpAddr})` : row.devName,
            group: (row.devOidGroup || '').trim(),
        }));
}

/** One row of `native.oids` - the OID table of the config dialog */
export interface OidRow {
    oidAct: boolean;
    oidGroup: string;
    oidName: string;
    oidOid: string;
    oidFormat: number;
    oidWriteable: boolean;
    oidOptional: boolean;
}

/**
 * buildOidRow - the OID table row for a node of the MIB tree
 *
 *		With `pUseMibNames` the symbolic name is stored, so that the adapter resolves it at startup
 *		and derives the object id from it. Without the option the numeric oid is stored, exactly as
 *		if it had been typed in by hand.
 *
 * @param pNode node of the MIB tree
 * @param pGroup OID group the row is added to
 * @param pUseMibNames true if the option "use MIB names" is active
 * @returns the new row
 */
export function buildOidRow(pNode: MibTreeNode, pGroup: string, pUseMibNames: boolean): OidRow {
    /*
     * A node of a live walk brings the instance it was read with. A node of a MIB file does not:
     * a scalar is read at ".0" there, while a column of a table needs the index of a row, which
     * only the device can tell - such a node is taken over as it is and has to be completed by hand.
     */
    const instance = pNode.instance ?? (pNode.column ? '' : '0');
    const suffix = instance ? `.${instance}` : '';

    // the ".0" of a scalar addresses its only value and does not belong in the name of the state
    const name = instance && !(instance === '0' && !pNode.column) ? `${pNode.name}.${instance}` : pNode.name;
    const symbolic = pNode.symbol ? `${pNode.symbol}${suffix}` : '';

    return {
        oidAct: true,
        oidGroup: pGroup,
        oidName: name,
        oidOid: pUseMibNames && symbolic ? symbolic : `${pNode.oid}${pNode.instance ? '' : suffix}`,
        // 99 = automatic, the adapter then derives the state type from the snmp type
        oidFormat: 99,
        oidWriteable: pNode.writeable,
        oidOptional: false,
    };
}

/**
 * matchesFilter - true if the node itself matches the filter text
 *
 * @param pNode node of the MIB tree
 * @param pFilter lower case filter text
 * @returns true if name, symbol or oid contain the filter
 */
export function matchesFilter(pNode: MibTreeNode, pFilter: string): boolean {
    if (!pFilter) {
        return true;
    }
    return (
        pNode.name.toLowerCase().includes(pFilter) ||
        pNode.symbol.toLowerCase().includes(pFilter) ||
        pNode.oid.includes(pFilter)
    );
}

/**
 * filterTree - keep the nodes matching the filter together with their parents
 *
 * @param pNodes tree to filter
 * @param pFilter filter text, case insensitive
 * @returns a new tree containing the matching nodes and the path to them
 */
export function filterTree(pNodes: MibTreeNode[], pFilter: string): MibTreeNode[] {
    const filter = pFilter.trim().toLowerCase();
    if (!filter) {
        return pNodes;
    }

    const result: MibTreeNode[] = [];
    for (const node of pNodes) {
        const children = node.children ? filterTree(node.children, filter) : [];
        if (children.length || matchesFilter(node, filter)) {
            result.push({ ...node, children: children.length ? children : undefined });
        }
    }
    return result;
}

/**
 * suggestGroup - the OID group a newly added row should default to
 *
 * @param pRows current content of the OID table
 * @returns the group of the last row, or 'default' if the table is empty
 */
export function suggestGroup(pRows: OidRow[] | undefined): string {
    const groups = (pRows || []).map(row => row?.oidGroup).filter(group => !!group);
    return groups.length ? groups[groups.length - 1] : 'default';
}

/**
 * isConfigured - true if an oid group already contains a row for this node
 *
 * The comparison uses the value the row builder would store, so it matches whether the OID column
 * holds numeric oids or symbolic names.
 *
 * @param pNode node of the MIB tree
 * @param pRows current content of the OID table
 * @param pGroup oid group the browser adds to
 * @param pUseMibNames true if the option "use MIB names" is active
 * @returns true if the node is already part of the group
 */
export function isConfigured(
    pNode: MibTreeNode,
    pRows: OidRow[] | undefined,
    pGroup: string,
    pUseMibNames: boolean,
): boolean {
    const oid = buildOidRow(pNode, pGroup, pUseMibNames).oidOid;
    return (pRows || []).some(row => row?.oidGroup === pGroup && row?.oidOid === oid);
}

/**
 * addableNodes - the nodes of a tree which can still be added to an oid group
 *
 * The containers of a MIB tree carry no value of their own, so only readable nodes are offered, and
 * a node the group already contains is left out - adding it twice would create a duplicate state.
 *
 * @param pNodes tree to walk, usually the filtered one
 * @param pRows current content of the OID table
 * @param pGroup oid group the browser adds to
 * @param pUseMibNames true if the option "use MIB names" is active
 * @returns every node which would produce a new row, parents first
 */
export function addableNodes(
    pNodes: MibTreeNode[],
    pRows: OidRow[] | undefined,
    pGroup: string,
    pUseMibNames: boolean,
): MibTreeNode[] {
    const nodes: MibTreeNode[] = [];

    const walk = (level: MibTreeNode[]): void => {
        for (const node of level) {
            if (node.readable && !isConfigured(node, pRows, pGroup, pUseMibNames)) {
                nodes.push(node);
            }
            if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(pNodes);

    return nodes;
}

/** the device the setup wizard collects, before it becomes a row of the device table */
export interface WizardDevice {
    name: string;
    /** hostname, IPv4 or IPv6 address, optionally with ":<port>" appended */
    ipAddr: string;
    ip6: boolean;
    /** 1 = v1, 2 = v2c, 3 = v3 */
    snmpVers: number;
    /** community (v1, v2c) or the id of an authorization set (v3) */
    authId: string;
    /** oid group of the device; empty means "name it after the device" */
    group: string;
}

/** what the wizard starts with - the values match the defaults of the device table */
export const DEFAULT_WIZARD_DEVICE: WizardDevice = {
    name: '',
    ipAddr: '',
    ip6: false,
    snmpVers: 1,
    authId: 'public',
    group: '',
};

/**
 * buildDeviceRow - the row of `native.devs` for a device of the wizard
 *
 * The timings are the defaults of the device table - they can be changed there afterwards.
 *
 * @param pDevice the device the wizard collected
 * @returns the new row
 */
export function buildDeviceRow(pDevice: WizardDevice): DeviceRow {
    const name = (pDevice.name || '').trim();

    return {
        devAct: true,
        devName: name,
        devIpAddr: (pDevice.ipAddr || '').trim(),
        devIp6: !!pDevice.ip6,
        // a device without an explicit group gets one of its own, named after it
        devOidGroup: (pDevice.group || '').trim() || name,
        devSnmpVers: pDevice.snmpVers,
        devAuthId: (pDevice.authId || '').trim(),
        devTimeout: 5,
        devRetryIntvl: 5,
        devPollIntvl: 30,
    };
}

/**
 * deviceIssues - what keeps the wizard from creating this device
 *
 * @param pDevice the device the wizard collected
 * @param pRows current content of the device table
 * @returns the reasons, as the suffix of the i18n key which describes them
 */
export function deviceIssues(pDevice: WizardDevice, pRows: DeviceRow[] | undefined): string[] {
    const issues: string[] = [];
    const name = (pDevice.name || '').trim();
    const ipAddr = (pDevice.ipAddr || '').trim();

    if (!name) {
        issues.push('name');
    } else if (name.endsWith('.') || name.includes('..')) {
        // the adapter builds the object ids from the name, both would break the object tree
        issues.push('nameInvalid');
    } else if ((pRows || []).some(row => (row?.devName || '').trim() === name)) {
        issues.push('duplicate');
    }

    // 0.0.0.0 is the placeholder a new row of the device table starts with
    if (!ipAddr || ipAddr === '0.0.0.0') {
        issues.push('ip');
    }

    return issues;
}

/**
 * pickNodes - the nodes of a tree which the user has selected
 *
 * @param pNodes tree to walk
 * @param pOids oids of the selected nodes
 * @returns the selected nodes, in the order of the tree
 */
export function pickNodes(pNodes: MibTreeNode[], pOids: string[]): MibTreeNode[] {
    const wanted = new Set(pOids);
    const nodes: MibTreeNode[] = [];

    const walk = (level: MibTreeNode[]): void => {
        for (const node of level) {
            if (wanted.has(node.oid)) {
                nodes.push(node);
            }
            if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(pNodes);

    return nodes;
}

/**
 * findNode - the node with that oid, anywhere in the tree
 *
 * @param pNodes tree to search
 * @param pOid numeric oid of the wanted node
 * @returns the node or null
 */
export function findNode(pNodes: MibTreeNode[], pOid: string): MibTreeNode | null {
    for (const node of pNodes) {
        if (node.oid === pOid) {
            return node;
        }
        const hit = node.children ? findNode(node.children, pOid) : null;
        if (hit) {
            return hit;
        }
    }

    return null;
}

/**
 * insertChildren - fill in the children of one node
 *
 * The live browser reads one level at a time, so a folder is displayed before its content is known.
 * The tree is rebuilt down to that node, so that React sees new objects and redraws.
 *
 * @param pNodes the tree
 * @param pOid oid of the node whose children have been read
 * @param pChildren what the device reported below that oid
 * @returns a new tree with the children in place
 */
export function insertChildren(pNodes: MibTreeNode[], pOid: string, pChildren: MibTreeNode[]): MibTreeNode[] {
    return pNodes.map(node => {
        if (node.oid === pOid) {
            // an empty answer means the folder is empty - it must not stay "not read yet"
            return { ...node, children: pChildren, hasChildren: pChildren.length > 0 };
        }
        if (node.children && pOid.startsWith(`${node.oid}.`)) {
            return { ...node, children: insertChildren(node.children, pOid, pChildren) };
        }
        return node;
    });
}

/** the marker every template file carries, so that a wrong file is recognized as such */
export const TEMPLATE_FORMAT = 'snmp-template';

/** One OID of a template - a row of the OID table without the group, which is chosen on import */
export interface TemplateOid {
    oidName: string;
    oidOid: string;
    oidFormat: number;
    oidWriteable: boolean;
    oidOptional: boolean;
}

/** A set of OID definitions for one device or device class, exchangeable as a json file */
export interface OidTemplate {
    format: typeof TEMPLATE_FORMAT;
    version: number;
    /** name of the template, shown in the import list */
    name: string;
    /** the device or the class of devices the template was made for */
    deviceClass?: string;
    description?: string;
    /** the MIB the oids come from - information for the reader, the oids are numeric */
    mib?: string;
    oids: TemplateOid[];
}

/**
 * buildTemplate - the template of one oid group
 *
 * The group itself is not part of it: it belongs to the installation, not to the device class, and
 * is chosen again when the template is imported.
 *
 * @param pRows current content of the OID table
 * @param pGroup name of the oid group to export
 * @param pName name of the template
 * @returns the template, with the oids of that group in the order of the table
 */
export function buildTemplate(pRows: OidRow[] | undefined, pGroup: string, pName: string): OidTemplate {
    const group = (pGroup || '').trim();

    return {
        format: TEMPLATE_FORMAT,
        version: 1,
        name: (pName || '').trim() || group,
        oids: (pRows || [])
            .filter(row => row?.oidGroup === group)
            .map(row => ({
                oidName: row.oidName,
                oidOid: row.oidOid,
                oidFormat: row.oidFormat,
                oidWriteable: !!row.oidWriteable,
                oidOptional: !!row.oidOptional,
            })),
    };
}

/**
 * parseTemplate - read a template file
 *
 * @param pText content of the file
 * @returns the template, or the reason why the file cannot be used
 */
export function parseTemplate(pText: string): { template?: OidTemplate; error?: string } {
    let data: Partial<OidTemplate>;
    try {
        data = JSON.parse(pText) as Partial<OidTemplate>;
    } catch (e) {
        return { error: (e as Error).message };
    }

    if (data?.format !== TEMPLATE_FORMAT) {
        return { error: 'notATemplate' };
    }
    if (!Array.isArray(data.oids) || !data.oids.length) {
        return { error: 'noOids' };
    }
    // a name is missing in a hand written file more often than anything else
    if (!data.name) {
        return { error: 'noName' };
    }

    for (const oid of data.oids) {
        if (!oid?.oidName || !oid?.oidOid) {
            return { error: 'incompleteOid' };
        }
    }

    return { template: data as OidTemplate };
}

/**
 * templateRows - the rows a template adds to one oid group
 *
 * @param pTemplate the template
 * @param pGroup oid group the rows belong to
 * @returns one row per oid of the template, active and with the defaults of the table
 */
export function templateRows(pTemplate: OidTemplate, pGroup: string): OidRow[] {
    const group = (pGroup || '').trim();

    return pTemplate.oids.map(oid => ({
        oidAct: true,
        oidGroup: group,
        oidName: oid.oidName,
        oidOid: oid.oidOid,
        // an old template may miss the format - "automatic" is what the dialog offers as default
        oidFormat: typeof oid.oidFormat === 'number' ? oid.oidFormat : 99,
        oidWriteable: !!oid.oidWriteable,
        oidOptional: !!oid.oidOptional,
    }));
}

/**
 * importTemplate - the OID table after importing a template
 *
 * @param pRows current content of the OID table
 * @param pTemplate the template to import
 * @param pGroup oid group the template is imported into
 * @param pReplace true to drop the rows the group already has, false to add to them
 * @returns the new content of the OID table
 */
export function importTemplate(
    pRows: OidRow[] | undefined,
    pTemplate: OidTemplate,
    pGroup: string,
    pReplace: boolean,
): OidRow[] {
    const group = (pGroup || '').trim();
    const rows = pRows || [];
    const kept = pReplace ? rows.filter(row => row?.oidGroup !== group) : rows;

    return [...kept, ...templateRows(pTemplate, group)];
}

/**
 * oidGroups - the oid groups a configuration knows
 *
 * @param pRows current content of the OID table
 * @param pDevices current content of the device table
 * @returns every group name which appears in one of the two tables, without duplicates
 */
export function oidGroups(pRows: OidRow[] | undefined, pDevices: DeviceRow[] | undefined): string[] {
    const groups = new Set<string>();

    for (const row of pRows || []) {
        const group = (row?.oidGroup || '').trim();
        if (group) {
            groups.add(group);
        }
    }
    for (const device of pDevices || []) {
        const group = (device?.devOidGroup || '').trim();
        if (group) {
            groups.add(group);
        }
    }

    return [...groups].sort();
}
