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
    /** live walk only - instance suffix, e.g. "1" for ifDescr.1 */
    instance?: string;
    /** live walk only - value read from the device */
    value?: string;
    /** live walk only - textual snmp object type of the value read */
    type?: string;
    children?: MibTreeNode[];
}

/** One loaded MIB module */
export interface MibModuleInfo {
    name: string;
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

/** Response of the `mibNodes` and `mibWalk` commands */
export interface MibNodesResponse {
    nodes: MibTreeNode[];
    /** set if the request failed */
    error?: string;
    /** set by mibWalk if the walk has been stopped because the limit was reached */
    truncated?: boolean;
}

/** Response of the `mibDevices` command */
export interface MibDevicesResponse {
    devices: { value: string; label: string }[];
    error?: string;
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
    const name = pNode.instance ? `${pNode.name}.${pNode.instance}` : pNode.name;
    const symbolic = pNode.symbol ? (pNode.instance ? `${pNode.symbol}.${pNode.instance}` : pNode.symbol) : '';

    return {
        oidAct: true,
        oidGroup: pGroup,
        oidName: name,
        oidOid: pUseMibNames && symbolic ? symbolic : pNode.oid,
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
 * collectOids - the oids of a tree and of everything below it
 *
 * @param pNodes tree to walk
 * @returns every oid contained in the tree
 */
export function collectOids(pNodes: MibTreeNode[]): string[] {
    const oids: string[] = [];
    const walk = (nodes: MibTreeNode[]): void => {
        for (const node of nodes) {
            oids.push(node.oid);
            if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(pNodes);
    return oids;
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
