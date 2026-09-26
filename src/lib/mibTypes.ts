/**
 * snmp adapter - types shared between the backend and the admin MIB browser component
 *
 * NOTE: this file is the contract of the `mib*` sendTo commands. The admin component under
 * src-admin/ keeps its own copy of these types (it is a separate bundle and cannot import from
 * build/), so both have to be changed together.
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
}

/** An oid specification split into its base and the instance suffix */
export interface OidSpec {
    /** numeric oid or symbolic name, optionally module qualified */
    base: string;
    /** instance suffix without the leading dot, empty if the specification has none */
    instance: string;
}

/** A resolved oid specification */
export interface ResolvedOid {
    /** numeric oid including the instance suffix - this is what is sent to the device */
    oid: string;
    /** module qualified symbol of the base, empty if the oid is not covered by a MIB */
    symbol: string;
    /** object name of the base, empty if the oid is not covered by a MIB */
    name: string;
    /** instance suffix without the leading dot */
    instance: string;
}
