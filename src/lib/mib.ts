/**
 * snmp adapter - MIB handling
 *
 * Wraps net-snmp's ModuleStore: keeps the uploaded MIB files on disk, parses them and answers the
 * two questions the adapter needs:
 *
 *   - which numeric oid does "IF-MIB::ifDescr.1" refer to   (resolve)
 *   - which symbol does 1.3.6.1.2.1.2.2.1.2.1 belong to     (describe)
 *
 * plus it builds the tree the admin MIB browser displays.
 */

import { createModuleStore } from 'net-snmp';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MibModuleInfo, MibTreeNode, OidSpec, ResolvedOid } from './mibTypes';

/** One parsed MIB entry as returned by net-snmp's ModuleStore.getModule() */
interface MibEntry {
    ObjectName?: string;
    ModuleName?: string;
    MACRO?: string;
    SYNTAX?: string | Record<string, unknown>;
    STATUS?: string;
    DESCRIPTION?: string;
    ACCESS?: string;
    'MAX-ACCESS'?: string;
    OID?: string;
    NameSpace?: string;
}

/**
 * The part of net-snmp's ModuleStore this adapter uses.
 *
 * `createModuleStore()` is typed as `any` by `@types/net-snmp`, so the shape is declared here to keep
 * the rest of the file free of `any`.
 */
interface ModuleStore {
    loadBaseModules: () => void;
    loadFromFile: (fileName: string) => void;
    getModuleNames: (includeBase?: boolean) => string[];
    getModule: (name: string) => Record<string, MibEntry> | undefined;
    translations: {
        oidToPath: Record<string, string>;
        oidToModule: Record<string, string>;
        pathToOid: Record<string, string>;
        moduleToOid: Record<string, string>;
    };
}

/** a purely numeric oid, with or without a leading dot */
const NUMERIC_OID = /^\.?\d+(\.\d+)*$/;
/** [MODULE::]name[.instance] */
const SYMBOLIC_OID = /^(?:([A-Za-z0-9][A-Za-z0-9-]*)::)?([A-Za-z][A-Za-z0-9-]*)((?:\.\d+)*)$/;

/**
 * splitOidSpec - split an oid specification into its base and the instance suffix
 *
 * A numeric oid is never split - every sub identifier of it may be part of the oid itself.
 *
 *     "IF-MIB::ifDescr.1" -> { base: "IF-MIB::ifDescr", instance: "1" }
 *     "ifDescr.1.2"       -> { base: "ifDescr",         instance: "1.2" }
 *     "1.3.6.1.2.1.1.5.0" -> { base: "1.3.6.1.2.1.1.5.0", instance: "" }
 *     ".1.3.6.1"          -> { base: "1.3.6.1",           instance: "" }
 *
 * @param pSpec oid specification as entered in the configuration
 * @returns base and instance suffix; the base is empty if the specification is malformed
 */
export function splitOidSpec(pSpec: string): OidSpec {
    const spec = (pSpec || '').trim();

    if (NUMERIC_OID.test(spec)) {
        return { base: spec.replace(/^\./, ''), instance: '' };
    }

    const parts = SYMBOLIC_OID.exec(spec);
    if (!parts) {
        return { base: '', instance: '' };
    }

    const module = parts[1] ? `${parts[1]}::` : '';
    return { base: `${module}${parts[2]}`, instance: parts[3].replace(/^\./, '') };
}

/**
 * isNumericOid - true if the specification is a plain numeric oid and needs no MIB to be used
 *
 * @param pSpec oid specification
 * @returns true if the specification consists of digits and dots only
 */
export function isNumericOid(pSpec: string): boolean {
    return NUMERIC_OID.test((pSpec || '').trim());
}

/**
 * syntaxToText - convert the SYNTAX clause of a MIB entry into a displayable string
 *
 * net-snmp reports the clause either as a string ("Integer32") or, as soon as it carries
 * constraints, as an object ({ DisplayString: { sizes: [ ... ] } }).
 *
 * @param pSyntax SYNTAX clause as parsed by net-snmp
 * @returns name of the syntax or an empty string
 */
export function syntaxToText(pSyntax: string | Record<string, unknown> | undefined): string {
    if (!pSyntax) {
        return '';
    }
    if (typeof pSyntax === 'string') {
        return pSyntax;
    }
    return Object.keys(pSyntax)[0] || '';
}

/**
 * a module name net-snmp invents for a file without a valid "<NAME> DEFINITIONS ::= BEGIN" header
 */
const INVALID_MODULE = 'undefined';

/**
 * loadOneFile - load a single MIB file into a ModuleStore and find out whether it worked
 *
 * net-snmp's parser reports a malformed file with `console.warn` and returns normally instead of
 * throwing, and it even registers a module named "undefined" for a file without a proper header.
 * Therefore the console is captured for the duration of the parse and the module list is compared
 * before and after, so that the admin can show the user why an upload was rejected.
 *
 * @param pStore module store to load into
 * @param pFileName absolute path of the MIB file
 * @returns null on success, otherwise the reason why the file could not be used
 */
function loadOneFile(pStore: ModuleStore, pFileName: string): string | null {
    const before = new Set(pStore.getModuleNames(true));
    const messages: string[] = [];

    const original = { log: console.log, warn: console.warn, error: console.error };
    const capture = (...args: unknown[]): void => {
        // net-snmp only ever logs strings and numbers here, anything else is of no use to the user
        const parts = args.map(arg => (typeof arg === 'string' ? arg : typeof arg === 'number' ? `${arg}` : ''));
        // the first argument may carry printf style placeholders - fill them in positionally
        let text = parts.join(' ');
        if (parts[0]?.includes('%s')) {
            let idx = 1;
            text = parts[0].replace(/%s/g, () => parts[idx++] ?? '');
        }
        messages.push(text.trim());
    };

    try {
        console.log = capture;
        console.warn = capture;
        console.error = capture;
        pStore.loadFromFile(pFileName);
    } catch (e) {
        return (e as Error).message;
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }

    const added = pStore.getModuleNames(true).filter(name => !before.has(name) && name !== INVALID_MODULE);
    if (added.length) {
        return null;
    }

    return messages.length ? messages.join('; ') : 'file does not define a MIB module';
}

/** name of the sub directory of the instance data directory which holds the MIB files */
export const MIB_SUB_DIR = 'mibs';

export class MibStore {
    private readonly log: ioBroker.Logger;
    /** directory the MIB files are written to - net-snmp can only parse files, not strings */
    private readonly mibDir: string;

    private store: ModuleStore | null = null;
    /** module names of the MIBs net-snmp ships itself */
    private baseModuleNames: string[] = [];
    /** module names of the MIBs uploaded by the user */
    private userModuleNames: string[] = [];
    /** file name -> parser error, for the files which could not be loaded */
    private loadErrors: Record<string, string> = {};
    /** numeric oid -> "MODULE::name" */
    private oidToSymbol: Record<string, string> = {};
    /** "MODULE::name" -> numeric oid */
    private symbolToOid: Record<string, string> = {};
    /** bare object name -> numeric oid; if a name exists in several modules the first one wins */
    private nameToOid: Record<string, string> = {};
    /** numeric oid -> parsed MIB entry */
    private entries: Record<string, MibEntry> = {};

    public constructor(pLog: ioBroker.Logger, pDataDir: string) {
        this.log = pLog;
        this.mibDir = join(pDataDir, MIB_SUB_DIR);
    }

    /** directory the MIB files are stored in */
    public get directory(): string {
        return this.mibDir;
    }

    /** true if at least one MIB module is available */
    public get loaded(): boolean {
        return this.store !== null;
    }

    /**
     * writeFiles - replace the content of the MIB directory
     *
     * All MIB files must live in one directory, because net-snmp's parser resolves the IMPORTS of a
     * module relative to the file it is reading.
     *
     * @param pFiles file name and content of every MIB file
     */
    public writeFiles(pFiles: { name: string; data: Buffer | string }[]): void {
        try {
            rmSync(this.mibDir, { recursive: true, force: true });
        } catch (e) {
            this.log.warn(`cannot clean mib directory "${this.mibDir}": ${(e as Error).message}`);
        }
        mkdirSync(this.mibDir, { recursive: true });

        for (const file of pFiles) {
            // never let a file name escape the mib directory
            const name = file.name.replace(/[\\/]/g, '_');
            try {
                writeFileSync(join(this.mibDir, name), file.data);
            } catch (e) {
                this.log.warn(`cannot store mib file "${name}": ${(e as Error).message}`);
            }
        }
    }

    /**
     * load - (re)parse all MIB files of the MIB directory
     *
     * Every file is loaded on its own, so that one unparsable file does not hide all the others.
     * The whole set is loaded twice: a module which IMPORTS a module that is loaded later fails on
     * the first pass and succeeds on the second one.
     */
    public load(): void {
        const store = createModuleStore() as ModuleStore;
        this.loadErrors = {};

        try {
            store.loadBaseModules();
        } catch (e) {
            this.log.error(`cannot load the base mib modules: ${(e as Error).message}`);
            return;
        }
        this.baseModuleNames = store.getModuleNames(true);

        let files: string[] = [];
        try {
            files = readdirSync(this.mibDir).sort();
        } catch {
            /* no mib directory yet - only the base modules are available */
        }

        let pending = files;
        for (let pass = 0; pass < 2 && pending.length; pass++) {
            const failed: string[] = [];
            for (const file of pending) {
                const error = loadOneFile(store, join(this.mibDir, file));
                if (error) {
                    this.loadErrors[file] = error;
                    failed.push(file);
                } else {
                    delete this.loadErrors[file];
                }
            }
            pending = failed;
        }

        for (const [file, error] of Object.entries(this.loadErrors)) {
            this.log.warn(`mib file "${file}" cannot be parsed: ${error}`);
        }

        this.store = store;
        this.userModuleNames = store.getModuleNames(false).filter(name => name !== INVALID_MODULE);
        this.buildIndex();

        this.log.info(
            `${Object.keys(this.symbolToOid).length} mib symbols available from ${this.userModuleNames.length} uploaded and ${this.baseModuleNames.length} built in module(s)`,
        );
    }

    /** buildIndex - build the lookup tables from the parsed modules */
    private buildIndex(): void {
        this.oidToSymbol = {};
        this.symbolToOid = {};
        this.nameToOid = {};
        this.entries = {};

        if (!this.store) {
            return;
        }

        for (const moduleName of this.store.getModuleNames(true)) {
            if (moduleName === INVALID_MODULE) {
                continue;
            }
            const module = this.store.getModule(moduleName);
            if (!module) {
                continue;
            }
            for (const entry of Object.values(module)) {
                if (!entry.OID || !entry.ObjectName) {
                    continue;
                }
                const symbol = `${moduleName}::${entry.ObjectName}`;
                this.entries[entry.OID] = entry;
                this.oidToSymbol[entry.OID] = symbol;
                this.symbolToOid[symbol] = entry.OID;
                this.nameToOid[entry.ObjectName] ??= entry.OID;
            }
        }
    }

    /**
     * resolve - resolve an oid specification into the numeric oid to be sent to the device
     *
     * @param pSpec oid specification, numeric or symbolic, with an optional instance suffix
     * @returns the resolved oid or null if the symbol is unknown resp. the specification malformed
     */
    public resolve(pSpec: string): ResolvedOid | null {
        const { base, instance } = splitOidSpec(pSpec);
        if (!base) {
            return null;
        }

        if (isNumericOid(base)) {
            // a numeric oid may address an instance of a symbol - report the symbol if there is one
            const described = this.describe(base);
            return {
                oid: base,
                symbol: described?.symbol ?? '',
                name: described?.name ?? '',
                instance: described?.instance ?? '',
            };
        }

        const oid = this.symbolToOid[base] ?? (base.includes('::') ? undefined : this.nameToOid[base]);
        if (!oid) {
            return null;
        }

        const symbol = this.oidToSymbol[oid];
        return {
            oid: instance ? `${oid}.${instance}` : oid,
            symbol: symbol,
            name: symbol.split('::')[1],
            instance: instance,
        };
    }

    /**
     * describe - find the symbol a numeric oid belongs to
     *
     * The oid of a table column is followed by the instance identifier, so the longest known prefix
     * of the oid is looked for and everything behind it is reported as the instance.
     *
     * @param pOid numeric oid
     * @returns symbol, object name and instance suffix, or null if no MIB covers the oid
     */
    public describe(pOid: string): ResolvedOid | null {
        const oid = (pOid || '').trim().replace(/^\./, '');
        if (!isNumericOid(oid)) {
            return null;
        }

        const parts = oid.split('.');
        for (let len = parts.length; len > 0; len--) {
            const base = parts.slice(0, len).join('.');
            const symbol = this.oidToSymbol[base];
            if (symbol) {
                return {
                    oid: oid,
                    symbol: symbol,
                    name: symbol.split('::')[1],
                    instance: parts.slice(len).join('.'),
                };
            }
        }
        return null;
    }

    /**
     * stateIdFor - the state id an oid specification gets when optUseMibNames is active
     *
     * @param pSpec oid specification
     * @returns "<objectName>[.<instance>]" or null if no MIB covers the specification
     */
    public stateIdFor(pSpec: string): string | null {
        const resolved = this.resolve(pSpec);
        if (!resolved?.name) {
            return null;
        }
        return resolved.instance ? `${resolved.name}.${resolved.instance}` : resolved.name;
    }

    /**
     * getModules - information about all loaded modules
     *
     * @returns one entry per module, built in modules last
     */
    public getModules(): MibModuleInfo[] {
        const count = (moduleName: string): number => {
            const module = this.store?.getModule(moduleName);
            return module ? Object.values(module).filter(entry => !!entry.OID).length : 0;
        };

        return [
            ...this.userModuleNames.map(name => ({ name, symbols: count(name), base: false })),
            ...this.baseModuleNames.map(name => ({ name, symbols: count(name), base: true })),
        ];
    }

    /** getLoadErrors - the files which could not be parsed, keyed by file name */
    public getLoadErrors(): Record<string, string> {
        return { ...this.loadErrors };
    }

    /**
     * getTree - build the tree of one module for the MIB browser
     *
     * @param pModuleName name of the module
     * @returns the root nodes of the module; an empty array if the module is not loaded
     */
    public getTree(pModuleName: string): MibTreeNode[] {
        const module = this.store?.getModule(pModuleName);
        if (!module) {
            return [];
        }

        const nodes: MibTreeNode[] = [];
        for (const entry of Object.values(module)) {
            if (!entry.OID || !entry.ObjectName) {
                continue;
            }
            nodes.push(this.toTreeNode(entry.OID, entry));
        }

        return buildTree(nodes);
    }

    /**
     * toTreeNode - convert a parsed MIB entry into a tree node
     *
     * @param pOid numeric oid of the node
     * @param pEntry parsed MIB entry, may be missing for an oid no MIB covers
     * @returns the tree node
     */
    private toTreeNode(pOid: string, pEntry?: MibEntry): MibTreeNode {
        const entry = pEntry ?? this.entries[pOid];
        if (!entry?.ObjectName) {
            return {
                symbol: '',
                name: pOid.split('.').pop() ?? pOid,
                oid: pOid,
                module: '',
                readable: false,
                writeable: false,
            };
        }

        const access = entry['MAX-ACCESS'] ?? entry.ACCESS ?? '';
        const module = entry.ModuleName ?? '';
        const syntax = syntaxToText(entry.SYNTAX);

        return {
            symbol: `${module}::${entry.ObjectName}`,
            name: entry.ObjectName,
            oid: pOid,
            module: module,
            syntax: syntax || undefined,
            access: access || undefined,
            description: entry.DESCRIPTION || undefined,
            // a node is pollable if it carries a value - tables and their entries do not
            readable: !!access && access !== 'not-accessible' && !syntax.startsWith('SEQUENCE'),
            writeable: access === 'read-write' || access === 'read-create',
        };
    }

    /**
     * describeWalkResult - turn the varbinds of a live walk into a tree
     *
     * @param pVarbinds oid, value and type of every varbind read from the device
     * @returns the root nodes of the walk result
     */
    public describeWalkResult(pVarbinds: { oid: string; value: string; type: string }[]): MibTreeNode[] {
        const nodes: MibTreeNode[] = [];

        for (const varbind of pVarbinds) {
            const described = this.describe(varbind.oid);
            const base = described ? varbind.oid.slice(0, varbind.oid.length - (described.instance.length + 1)) : '';
            const node = this.toTreeNode(described && described.instance ? base : varbind.oid);

            nodes.push({
                ...node,
                oid: varbind.oid,
                instance: described?.instance || undefined,
                value: varbind.value,
                type: varbind.type,
                // the walk only returns oids which really carry a value
                readable: true,
            });
        }

        return buildTree(nodes);
    }
}

/**
 * buildTree - arrange a flat list of nodes into a tree following their numeric oids
 *
 * A node becomes the child of the node with the longest oid that is a prefix of its own oid. Nodes
 * whose parents are not part of the list stay at the top level, so that the tree of a single module
 * starts at its own root instead of at iso(1).
 *
 * @param pNodes flat list of nodes, in any order
 * @returns the root nodes, children sorted by their oid
 */
export function buildTree(pNodes: MibTreeNode[]): MibTreeNode[] {
    const byOid = new Map<string, MibTreeNode>();
    for (const node of pNodes) {
        byOid.set(node.oid, { ...node, children: undefined });
    }

    const roots: MibTreeNode[] = [];

    for (const node of byOid.values()) {
        const parts = node.oid.split('.');
        let parent: MibTreeNode | undefined;
        for (let len = parts.length - 1; len > 0 && !parent; len--) {
            parent = byOid.get(parts.slice(0, len).join('.'));
        }

        if (parent) {
            parent.children ??= [];
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    const byOidOrder = (a: MibTreeNode, b: MibTreeNode): number => compareOids(a.oid, b.oid);
    const sort = (nodes: MibTreeNode[]): void => {
        nodes.sort(byOidOrder);
        for (const node of nodes) {
            if (node.children) {
                sort(node.children);
            }
        }
    };
    sort(roots);

    return roots;
}

/**
 * compareOids - numeric comparison of two oids, sub identifier by sub identifier
 *
 * @param pA first oid
 * @param pB second oid
 * @returns negative, 0 or positive as expected by Array.sort
 */
export function compareOids(pA: string, pB: string): number {
    const a = pA.split('.');
    const b = pB.split('.');
    for (let ii = 0; ii < Math.min(a.length, b.length); ii++) {
        const diff = Number(a[ii]) - Number(b[ii]);
        if (diff) {
            return diff;
        }
    }
    return a.length - b.length;
}
