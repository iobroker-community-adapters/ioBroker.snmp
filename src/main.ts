/**
 *
 * snmp adapter,
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 *
 */

/*
 * Some general REMINDERS for further development
 *
 * - Ensure that every timer value is less than 0x7fffffff - otherwise the time will fire immidiatly
 *
 */

/*
 * description of major internal objects
 *
 *	CTXs		array of CTX objects, see DeviceContext in lib/types.ts
 *	STATEs		state cache, indexed by full id, see StateCacheEntry in lib/types.ts
 */

import * as utils from '@iobroker/adapter-core';
import { isVarbindError, varbindError, type Varbind } from 'net-snmp';
import { isIPv4, isIPv6 } from 'node:net';

import { DEFAULT_SNMP_PORT, F_TEXT, SNMP_V3 } from './lib/constants';
import { InstallUtils } from './lib/installUtils';
import { isNumericOid, MibStore } from './lib/mib';
import type { MibModulesResponse, MibNodesResponse, MibTreeNode } from './lib/mibTypes';
import {
    snmpCloseSession,
    snmpCreateSession,
    snmpSessionGetAsync,
    snmpSessionGetNextAsync,
    snmpSessionSetAsync,
    snmpSessionSubtreeAsync,
} from './lib/snmpSession';
import type { AuthConfig, DeviceConfig, DeviceContext, OidConfig, SessionContext, StateCacheEntry } from './lib/types';
import { ip2ipStr, name2id, oidFormat2StateType, oidObjType2Text, oidStateRole } from './lib/utils';
import { varbindDecode, varbindEncode } from './lib/varbind';

/** Object definition as passed to `initObject` */
type InitObject = (ioBroker.SettableStateObject | ioBroker.SettableDeviceObject | ioBroker.SettableFolderObject) & {
    _id: string;
};

/** Values written by `setStates` to the base, the -type and the -raw state */
interface StateValues {
    val: ioBroker.StateValue;
    type: string;
    json: string;
}

/** maximum number of varbinds a single MIB browser walk returns */
/** largest sub identifier of an oid - used to skip a whole subtree with one getNext */
const MAX_SUB_ID = 4294967295;

/** maximum number of children the MIB browser reads for one folder */
const MIB_CHILDREN_LIMIT = 200;

/** maximum number of values one subtree may contribute when it is taken over as a whole */
const MIB_SUBTREE_LIMIT = 500;
/** name of the meta object which holds the uploaded MIB files */
const MIB_META_SUFFIX = 'mibs';

/**
 * true if the adapter has been started with '--install' - the process then only migrates the
 * configuration of all instances and terminates again.
 */
const DO_INSTALL = process.argv?.includes('--install') ?? false;

class Snmp extends utils.Adapter {
    /** context of all active devices */
    private readonly CTXs: DeviceContext[] = [];
    /** states cache, indexed by full id */
    private readonly STATEs: Record<string, StateCacheEntry> = {};
    /** local copy of the info.connection state */
    private isConnected = false;
    private shutdownInProgress = false;
    private connUpdateTimer: ioBroker.Interval | null = null;
    /** maximum number of OIDs per request */
    private chunkSize = 3;
    /** true as soon as the configuration migration has been executed */
    private didInstall = false;
    /** the parsed MIB modules, used to resolve symbolic oids and to feed the admin MIB browser */
    private readonly mibStore: MibStore;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'snmp' });

        // `this.log` does not exist yet - adapter-core creates it after the constructor has finished,
        // so the store gets a function which looks the logger up when it actually logs something
        this.mibStore = new MibStore(() => this.log, utils.getAbsoluteInstanceDataDir(this));

        this.on('ready', () => void this.onReady());
        this.on('stateChange', (id, state) => void this.onStateChange(id, state));
        this.on('message', obj => void this.onMessage(obj));
        this.on('unload', callback => this.onUnload(callback));

        if (DO_INSTALL) {
            process.on('exit', () => {
                if (!this.didInstall) {
                    console.log('WARNING: migration of config skipped - ioBroker might be stopped');
                }
            });
        }
    }

    // #################### object initialization functions ####################

    /**
     * delStates - delete all states matching a pattern
     *
     * @param pPattern pattern to match state id
     */
    private async delStates(pPattern: string): Promise<void> {
        this.log.debug(`delStates (${pPattern})`);

        const objs = await this.getForeignObjectsAsync(`${this.namespace}.${pPattern}`);
        if (objs) {
            if (Object.values(objs).length) {
                this.log.info(`removing states ${pPattern}...`);
            }
            for (const obj of Object.values(objs)) {
                this.log.debug(`removing object ${obj._id}...`);
                await this.delForeignObjectAsync(obj._id, { recursive: true });
            }
        }
    }

    /**
     * cleanupStates - cleanup unused states
     */
    private async cleanupStates(): Promise<void> {
        this.log.debug('cleanupStates ');

        // delete -raw states if no longer enabled
        if (!this.config.optRawStates) {
            await this.delStates('*-raw');
        }

        // delete -type states if no longer enabled
        if (!this.config.optTypeStates) {
            await this.delStates('*-type');
        }
    }

    /**
     * initObject - create or reconfigure single object
     *
     *		creates object if it does not exist
     *		overrides object data otherwise
     *		waits for action to complete using await
     *
     * @param pObj object structure
     */
    private async initObject(pObj: InitObject): Promise<void> {
        this.log.debug(`initobject ${pObj._id}`);

        const fullId = `${this.namespace}.${pObj._id}`;

        if (typeof this.STATEs[fullId] === 'undefined') {
            try {
                this.log.debug(`creating obj "${pObj._id}" with type ${pObj.type}`);
                await this.setObjectNotExistsAsync(pObj._id, pObj);
                await this.extendObjectAsync(pObj._id, pObj);
            } catch (e) {
                this.log.error(`error initializing obj "${pObj._id}" ${(e as Error).message}`);
            }
            this.STATEs[fullId] = {
                type: pObj.type,
                commonType: null,
            };
        }

        if (pObj.type === 'state') {
            if (typeof this.STATEs[fullId].commonType === 'undefined' || this.STATEs[fullId].commonType === null) {
                const obj = await this.getObjectAsync(pObj._id);
                this.STATEs[fullId] = {
                    commonType: (obj?.common as ioBroker.StateCommon | undefined)?.type ?? null,
                };
            }

            if (this.STATEs[fullId].commonType !== pObj.common.type) {
                try {
                    if (this.STATEs[fullId].commonType === 'mixed') {
                        this.log.debug(
                            `reinitializing obj "${pObj._id}" state-type change ${this.STATEs[fullId].commonType} -> ${pObj.common.type}`,
                        );
                    } else {
                        this.log.info(
                            `reinitializing obj "${pObj._id}" state-type change ${this.STATEs[fullId].commonType} -> ${pObj.common.type}`,
                        );
                    }
                    /*
                     * The role belongs to the type - a state which turns out to hold a text is a
                     * "text", not the "state" the format "automatic" started with.
                     */
                    await this.extendObjectAsync(pObj._id, {
                        common: {
                            type: pObj.common.type,
                            role: pObj.common.role,
                        },
                    });
                    this.STATEs[fullId].commonType = pObj.common.type;
                } catch (e) {
                    this.log.error(`error reinitializing obj "${pObj._id}" ${(e as Error).message}`);
                }
            }
        }
    }

    /**
     * initDeviceObjects - initializes all objects related to a device
     *
     * @param pId id of device
     * @param pIp ip of device
     */
    private async initDeviceObjects(pId: string, pIp: string): Promise<void> {
        this.log.debug(`initdeviceObjects (${pId}/${pIp})`);

        try {
            await this.delForeignObjectAsync(`${this.namespace}.${pId}.online`, { recursive: false });
        } catch {
            /* */
        }

        try {
            // create <ip> device object
            await this.initObject({
                _id: pId,
                type: 'device',
                common: {
                    name: pIp,
                    statusStates: {
                        onlineId: `${this.namespace}.${pId}.info.online`,
                        errorId: `${this.namespace}.${pId}.info.error`,
                    },
                },
                native: {},
            });

            // create <ip>.online and .alarm state objects
            await this.initObject({
                _id: `${pId}.info`,
                type: 'folder',
                common: {
                    name: '',
                    desc: 'folder containing device status states',
                },
                native: {},
            });
            await this.initObject({
                _id: `${pId}.info.online`,
                type: 'state',
                common: {
                    name: `${pId}.info.online`,
                    desc: 'true if device is reachable',
                    write: false,
                    read: true,
                    type: 'boolean',
                    role: 'indicator.reachable',
                },
                native: {},
            });
            await this.initObject({
                _id: `${pId}.info.error`,
                type: 'state',
                common: {
                    name: `${pId}.info.error`,
                    desc: 'true if error occured',
                    write: false,
                    read: true,
                    type: 'boolean',
                    role: 'indicator.error',
                },
                native: {},
            });
            await this.initObject({
                _id: `${pId}.info.error_text`,
                type: 'state',
                common: {
                    name: `${pId}.info.error_text`,
                    desc: 'text describing last error',
                    write: false,
                    read: true,
                    type: 'string',
                    role: 'text',
                },
                native: {},
            });
        } catch (e) {
            this.log.error(`error creating objects for ip "${pIp}" (${pId}), ${(e as Error).message}`);
        }
    }

    /**
     * initOidObjects - initializes objects for one OID
     *
     * ASSERTION: root device object is already created
     *
     * @param pId id of object
     * @param pOid oid as configured, used for the error message only
     * @param pOID oid configuration object
     */
    private async initOidObjects(pId: string, pOid: string, pOID: OidConfig): Promise<void> {
        this.log.debug(`initOidObjects (${pId})`);

        try {
            // create OID folder objects
            const idArr = pId.split('.');
            let partlyId = idArr[0];
            for (let ii = 1; ii < idArr.length - 1; ii++) {
                const el = idArr[ii];
                partlyId += `.${el}`;
                await this.initObject({
                    _id: partlyId,
                    type: 'folder',
                    common: {
                        name: '',
                    },
                    native: {},
                });
            }

            // create OID state objects
            // id ........ normal data returned (string, json, number, boolean)
            // id.type ... iod type code
            // id.raw .... json stringified origianl data received (optional)
            const stateType = oidFormat2StateType(pOID.oidFormat, this.log);
            await this.initObject({
                _id: pId,
                type: 'state',
                common: {
                    name: pId,
                    write: !!pOID.oidWriteable,
                    read: true,
                    type: stateType,
                    role: oidStateRole(stateType, !!pOID.oidWriteable),
                },
                native: {},
            });

            if (pOID.oidWriteable) {
                const fullId = `${this.namespace}.${pId}`;
                this.log.debug(`subscribing state ${fullId}`);
                await this.subscribeStatesAsync(fullId);
            }

            if (this.config.optTypeStates) {
                await this.initObject({
                    _id: `${pId}-type`,
                    type: 'state',
                    common: {
                        name: `${pId}-type`,
                        write: false,
                        read: true,
                        type: 'string',
                        role: 'text',
                    },
                    native: {},
                });
            }

            // create OID state.raw objects
            if (this.config.optRawStates) {
                await this.initObject({
                    _id: `${pId}-raw`,
                    type: 'state',
                    common: {
                        name: `${pId}-raw`,
                        write: false,
                        read: true,
                        type: 'string',
                        role: 'json',
                    },
                    native: {},
                });
            }
        } catch (e) {
            this.log.error(`error processing oid id "${pId}" (oid "${pOid}) - ${(e as Error).message}`);
        }
    }

    /**
     * initAllObjects - initialize all objects
     */
    private async initAllObjects(): Promise<void> {
        this.log.debug('initAllObjects - initializing objects');

        for (let ii = 0; ii < this.CTXs.length; ii++) {
            await this.initDeviceObjects(this.CTXs[ii].id, this.CTXs[ii].ipAddr);

            for (let cc = 0; cc < this.CTXs[ii].chunks.length; cc++) {
                for (let jj = 0; jj < this.CTXs[ii].chunks[cc].ids.length; jj++) {
                    await this.initOidObjects(
                        this.CTXs[ii].chunks[cc].ids[jj],
                        this.CTXs[ii].chunks[cc].oids[jj],
                        this.CTXs[ii].chunks[cc].OIDs[jj],
                    );
                }
            }
        }
    }

    // #################### snmp session handling functions ####################

    /**
     * onReaderSessionClose - callback called whenever a reader session is closed
     *
     * @param pCTX CTX object
     */
    private onReaderSessionClose(pCTX: DeviceContext): void {
        this.log.debug(`onReaderSessionClose - device ${pCTX.name} (${pCTX.ipAddr})`);

        if (pCTX.pollTimer) {
            this.clearInterval(pCTX.pollTimer);
        }
        pCTX.pollTimer = null;

        if (pCTX.sessCtx) {
            pCTX.sessCtx.session = null;
            pCTX.sessCtx = null;
        }

        if (!this.shutdownInProgress) {
            pCTX.retryTimer =
                this.setTimeout(
                    (ctx: DeviceContext) => {
                        ctx.retryTimer = null;
                        void this.createReaderSession(ctx);
                    },
                    pCTX.retryIntvl,
                    pCTX,
                ) ?? null;
        }
    }

    /**
     * onReaderSessionError - callback called whenever a reader session encounters an error
     *
     * @param pCTX CTX object
     * @param pErr error object
     */
    private onReaderSessionError(pCTX: DeviceContext, pErr: Error): void {
        this.log.debug(`onReaderSessionError - device ${pCTX.name} (${pCTX.ipAddr}) - ${pErr.toString()}`);

        this.log.warn(`device ${pCTX.name} (${pCTX.ipAddr}) reported error ${pErr.toString()}`);

        if (!this.config.optNoCloseOnError) {
            if (pCTX.pollTimer) {
                this.clearInterval(pCTX.pollTimer);
            }
            pCTX.pollTimer = null;

            if (pCTX.sessCtx) {
                snmpCloseSession(pCTX.sessCtx, this.log);
            }
            /* NOTE: this will trigger onReaderSessionClose which will open a new session */
        }
    }

    /**
     * createReaderSession - initializes a snmp reader session for one device and starts the reader thread
     *
     * @param pCTX CTX object
     */
    private async createReaderSession(pCTX: DeviceContext): Promise<void> {
        this.log.debug(`createReaderSession - device ${pCTX.name} (${pCTX.ipAddr})`);

        // (re)set device online and alarm status
        await this.setStateAsync(`${pCTX.id}.info.error`, { val: false, ack: true, q: 0x00 });
        await this.setStateAsync(`${pCTX.id}.info.online`, { val: false, ack: true, q: 0x00 });

        // stop existing timers and close session if one exists
        if (pCTX.retryTimer) {
            this.clearTimeout(pCTX.retryTimer);
            pCTX.retryTimer = null;
        }

        if (pCTX.pollTimer) {
            this.clearInterval(pCTX.pollTimer);
            pCTX.pollTimer = null;
        }

        if (pCTX.sessCtx) {
            snmpCloseSession(pCTX.sessCtx, this.log);
            pCTX.sessCtx = null;
        }

        // do NOT create any new session if already shutting down
        if (this.shutdownInProgress) {
            this.log.warn(
                `session for device "${pCTX.name}" (${pCTX.ipAddr}) NOT created as instance is shutting down`,
            );
            return;
        }

        // create snmp session for device
        pCTX.sessCtx = snmpCreateSession(pCTX, this.log);

        if (pCTX.sessCtx?.session) {
            // ok: session created

            pCTX.sessCtx.session.on('close', () => {
                this.onReaderSessionClose(pCTX);
            });
            pCTX.sessCtx.session.on('error', err => {
                this.onReaderSessionError(pCTX, err);
            });

            // read one time immediately
            await this.readOids(pCTX);

            // start recurrent reading
            pCTX.pollTimer =
                this.setInterval((ctx: DeviceContext) => void this.readOids(ctx), pCTX.pollIntvl, pCTX) ?? null;

            this.log.debug(`session for device "${pCTX.name}" (${pCTX.ipAddr}) created`);
        } else {
            // error: retry again

            this.log.debug(`session for device "${pCTX.name}" (${pCTX.ipAddr}) NOT created, will retry`);

            pCTX.retryTimer =
                this.setTimeout(
                    (ctx: DeviceContext) => {
                        ctx.retryTimer = null;
                        void this.createReaderSession(ctx);
                    },
                    pCTX.retryIntvl,
                    pCTX,
                ) ?? null;
        }
    }

    // #################### state handling functions ####################

    /**
     * setStates - set all states related to one oid
     *
     * @param pStateId (base) state id
     * @param pOptions options object as defined by adapter.setState
     * @param pValues (optional) values object containing values for base, type and json states
     */
    private async setStates(pStateId: string, pOptions: ioBroker.SettableState, pValues?: StateValues): Promise<void> {
        this.log.debug(`setStates - ${pStateId}`);

        const state = pOptions;

        if (pValues) {
            state.val = pValues.val;
        }
        await this.setStateAsync(pStateId, state);

        if (this.config.optTypeStates) {
            if (pValues) {
                state.val = pValues.type;
            }
            await this.setStateAsync(`${pStateId}-type`, state);
        }
        if (this.config.optRawStates) {
            if (pValues) {
                state.val = pValues.json;
            }
            await this.setStateAsync(`${pStateId}-raw`, state);
        }
    }

    /**
     * setOnlineState - set online state for a device
     *
     * @param pCTX device context object
     * @param pOnline true if device is online, false otherwise
     * @param pMsg (optional) text to add to info message
     * @param pErr (optional) text to use for error message, logged only if not null
     */
    private async setOnlineState(
        pCTX: DeviceContext,
        pOnline: boolean,
        pMsg: string | null,
        pErr: string | null,
    ): Promise<void> {
        await this.setStateAsync(`${pCTX.id}.info.online`, { val: pOnline, ack: true, q: 0x00 });

        let err: string | null = 'RequestTimedOutError: Request timed out';
        if (pErr) {
            err = pErr;
        }
        if (pOnline) {
            err = null;
        }
        await this.setStateAsync(`${pCTX.id}.info.error_text`, { val: err, ack: true, q: 0x00 });

        if (pCTX.initialized && pCTX.online === pOnline) {
            return;
        }

        if (pErr) {
            this.log.error(`[${pCTX.id}] ${pErr}`);
            await this.setStateAsync(`${pCTX.id}.info.error`, { val: true, ack: true, q: 0x00 });
        }
        if (pOnline) {
            await this.setStateAsync(`${pCTX.id}.info.error`, { val: false, ack: true, q: 0x00 });
        }

        let msg = pOnline ? 'connected' : 'disconnected';
        if (pMsg) {
            msg = `${msg} - ${pMsg}`;
        }
        this.log.info(`[${pCTX.id}] device ${msg}`);

        pCTX.initialized = true;
        pCTX.online = pOnline;
        setImmediate(() => void this.handleConnectionInfo());
    }

    /**
     * processVarbind - process single varbind
     *
     * @param pCTX CTX object
     * @param pStateId id of the state to update
     * @param pFormat format constant
     * @param pWriteable true if the state is writeable
     * @param pVarbind snmp varbind object
     */
    private async processVarbind(
        pCTX: DeviceContext,
        pStateId: string,
        pFormat: number,
        pWriteable: boolean,
        pVarbind: Varbind,
    ): Promise<void> {
        this.log.debug(`processVarbind - [${pCTX.id}] ${pStateId}`);

        const devId = pCTX.id;
        const fullId = `${this.namespace}.${pStateId}`;

        const state = varbindDecode(pVarbind, pFormat, devId, pStateId, this.log);

        this.log.debug(`[${devId}] ${pStateId} (${state.typeStr})${JSON.stringify(pVarbind)}`);
        this.log.debug(`[${devId}] update ${pStateId}: ${state.val}`);

        // data OK
        const stateType = oidFormat2StateType(state.format, this.log);
        await this.initObject({
            _id: pStateId,
            type: 'state',
            common: {
                name: devId,
                write: !!pWriteable,
                read: true,
                type: stateType,
                role: oidStateRole(stateType, !!pWriteable),
            },
            native: {},
        });

        await this.setStates(
            pStateId,
            { ack: true, q: state.qual },
            { val: state.val, type: `${pVarbind.type}: ${state.typeStr}`, json: JSON.stringify(pVarbind) },
        );

        if (pWriteable) {
            this.STATEs[fullId] = {
                CTX: pCTX,
                stateId: pStateId,
                format: pFormat,
            };
            this.STATEs[fullId].varbind = {
                oid: pVarbind.oid,
                type: pVarbind.type,
                value: null,
            };
        }
    }

    /**
     * readChunkOids - read all oids within one chunk from a specific target device
     *
     * @param pCTX specific context
     * @param pIdx chunk index
     */
    private async readChunkOids(pCTX: DeviceContext, pIdx: number): Promise<void> {
        this.log.debug(`readChunkOIDs - device "${pCTX.name}" (${pCTX.ipAddr}), chunk idx ${pIdx}`);

        const devId = pCTX.id;
        const oids = pCTX.chunks[pIdx].oids;

        if (!pCTX.sessCtx) {
            this.log.debug(`[${devId}] session.get - session context is null, skip processing`);
            return;
        }

        const result = await snmpSessionGetAsync(pCTX.sessCtx.session, oids, this.log);
        this.log.debug(`[${devId}] session.get completed for chunk index ${pIdx}`);
        if (result.err) {
            // error
            this.log.debug(`[${devId}] session.get: ${result.err.toString()}`);
            if (result.err.toString() === 'RequestTimedOutError: Request timed out') {
                // timeout error
                for (let ii = 0; ii < pCTX.chunks[pIdx].ids.length; ii++) {
                    await this.setStates(pCTX.chunks[pIdx].ids[ii], { ack: true, q: 0x02 }); // connection problem
                }
                await this.setOnlineState(pCTX, false, 'request timeout', null); // log info only
            } else {
                // other error
                for (let ii = 0; ii < pCTX.chunks[pIdx].ids.length; ii++) {
                    await this.setStates(pCTX.chunks[pIdx].ids[ii], { val: null, ack: true, q: 0x44 }); // device reports error
                }
                await this.setOnlineState(pCTX, false, null, `session.get: ${result.err.toString()}`); // log an error
            }
        } else {
            // success
            await this.setOnlineState(pCTX, true, null, null);

            // process returned values
            for (let ii = 0; ii < result.varbinds.length; ii++) {
                if (isVarbindError(result.varbinds[ii])) {
                    if (
                        !pCTX.chunks[pIdx].OIDs[ii].oidOptional ||
                        !varbindError(result.varbinds[ii]).startsWith('NoSuchInstance:')
                    ) {
                        this.log.error(`[${devId}] session.get: ${varbindError(result.varbinds[ii])}`);
                    }
                    await this.setStates(pCTX.chunks[pIdx].ids[ii], { val: null, ack: true, q: 0x84 }); // sensor reports error
                } else {
                    const OID = pCTX.chunks[pIdx].OIDs[ii];
                    const stateId = pCTX.chunks[pIdx].ids[ii];
                    void this.processVarbind(pCTX, stateId, OID.oidFormat, OID.oidWriteable, result.varbinds[ii]);
                }
            }
        }
    }

    /**
     * readOids - read all oids from a specific target device
     *
     * @param pCTX CTX object
     */
    private async readOids(pCTX: DeviceContext): Promise<void> {
        this.log.debug(`readOIDs - device "${pCTX.name}" (${pCTX.ipAddr})`);

        const devId = pCTX.id;

        for (let cc = 0; cc < pCTX.chunks.length; cc++) {
            this.log.debug(`[${devId}] processing oid chunk index ${cc}`);
            await this.readChunkOids(pCTX, cc);
            this.log.debug(`[${devId}] processing oid chunk index ${cc} completed`);
        }
    }

    // #################### general housekeeping functions ####################

    /**
     * handleConnectionInfo - update info.connection based on the state of all devices
     */
    private async handleConnectionInfo(): Promise<void> {
        this.log.debug('handleConnectionInfo');

        let haveConnection = false;
        for (let ii = 0; ii < this.CTXs.length; ii++) {
            if (this.CTXs[ii].online) {
                haveConnection = true;
            }
        }

        if (this.isConnected !== haveConnection) {
            if (haveConnection) {
                this.log.info('instance connected to at least one device');
            } else {
                this.log.info('instance disconnected from all devices');
            }
            this.isConnected = haveConnection;

            this.log.debug(`info.connection set to ${this.isConnected}`);
        }

        await this.setStateAsync('info.connection', this.isConnected, true);
    }

    /**
     * validateConfig - scan and validate config data
     *
     * @returns true if the configuration can be used
     */
    private validateConfig(): boolean {
        let ok = true;

        const oidSets: Record<string, boolean> = {};
        const authSets: Record<string, boolean> = {};

        this.log.debug('validateConfig - verifying oid-sets');

        // if ( this.config.optUseName ) {
        //    this.log.warn('Option compatibility mode has been deprecated; please consider to adapt config.');
        // }

        // ensure that at least empty config exists
        this.config.oids = this.config.oids || [];
        this.config.authSets = this.config.authSets || [];
        this.config.devs = this.config.devs || [];

        /*
         * An incomplete configuration is not an error: the adapter has to keep running while the
         * oids are being collected, because the MIB browser of the config dialog asks the running
         * instance for the MIB files and for the live data of a device.
         */
        if (!this.config.oids.length) {
            this.log.warn('no oids configured, please add configuration.');
        }

        for (let ii = 0; ii < this.config.oids.length; ii++) {
            const oid = this.config.oids[ii];

            if (!oid.oidAct) {
                continue;
            }

            oid.oidGroup = (oid.oidGroup || '').trim();
            oid.oidName = (oid.oidName || '').trim();
            oid.oidOid = (oid.oidOid || '').trim().replace(/^\./, '');

            const oidGroup = oid.oidGroup;

            if (!oid.oidGroup) {
                this.log.error('oid group must not be empty, please correct configuration.');
                ok = false;
            }

            if (!oid.oidName) {
                this.log.error('oid name must not be empty, please correct configuration.');
                ok = false;
            }

            // as ids must not end with a dot, the name must not end with a dot too
            // duplicate dots would result in empty folder names
            if (oid.oidName.endsWith('.')) {
                this.log.error(
                    `oid "${oid.oidName}"is invalid. Name must not end with ".". Please correct configuration.`,
                );
                ok = false;
            }
            if (oid.oidName.includes('..')) {
                this.log.error(
                    `oid "${oid.oidName}"is invalid. Name must not include consecutive dots. Please correct configuration.`,
                );
                ok = false;
            }
            if (oid.oidName === 'online') {
                this.log.error(
                    `oid "${oid.oidName}"is invalid. Name "online" is reserved. Please correct configuration.`,
                );
                ok = false;
            }
            if (oid.oidName.startsWith('info.')) {
                this.log.error(
                    `oid "${oid.oidName}"is invalid. Folder "info" is reserved. Please correct configuration.`,
                );
                ok = false;
            }

            if (!oid.oidOid) {
                this.log.error('oid must not be empty, please correct configuration.');
                ok = false;
            }

            if (this.config.optUseMibNames && !isNumericOid(oid.oidOid)) {
                // with optUseMibNames a symbolic name is allowed - it just has to resolve
                if (!this.mibStore.resolve(oid.oidOid)) {
                    this.log.error(
                        `oid "${oid.oidOid}" is not known by any loaded mib module, please correct configuration or upload the mib.`,
                    );
                    ok = false;
                }
            } else if (!/^\d+(\.\d+)*$/.test(oid.oidOid)) {
                this.log.error(`oid "${oid.oidOid}" has invalid format, please correct configuration.`);
                ok = false;
            }

            // TODO: oidGroup                       must be unique
            // TODO: oidGroup + oidName             must be unique
            // TODO: oidGroup + oidName + oidOid    must be unique

            oidSets[oidGroup] = true;
        }

        if (!ok) {
            this.log.debug('validateConfig - validation aborted (checks failed)');
            return false;
        }

        this.log.debug('validateConfig - verifying authorization data');

        for (let ii = 0; ii < this.config.authSets.length; ii++) {
            const authSet = this.config.authSets[ii];
            const authId = authSet.authId;
            if (!authId) {
                this.log.error('empty authorization id detected, please correct configuration.');
                ok = false;
                continue;
            }
            if (authSets[authId]) {
                this.log.error(`duplicate authorization id ${authId} detected, please correct configuration.`);
                ok = false;
                continue;
            }
            authSets[authId] = true;
        }

        if (!ok) {
            this.log.debug('validateConfig - validation aborted (checks failed)');
            return false;
        }

        this.log.debug('validateConfig - verifying devices');

        if (!this.config.devs.length) {
            this.log.warn('no devices configured, please add configuration.');
        }

        for (let ii = 0; ii < this.config.devs.length; ii++) {
            const dev = this.config.devs[ii];

            if (!dev.devAct) {
                continue;
            }

            dev.devName = (dev.devName || '').trim();
            dev.devIpAddr = (dev.devIpAddr || '').trim();
            dev.devOidGroup = (dev.devOidGroup || '').trim();
            dev.devAuthId = (dev.devAuthId || '').trim();

            // devicename is required, must not end with a dot or contain consecutive dots
            if (!dev.devName) {
                this.log.error('device name must not be empty, please correct configuration.');
                ok = false;
            }
            if (dev.devName.endsWith('.')) {
                this.log.error(
                    `devicename "${dev.devName}"is invalid. Name must not end with ".". Please correct configuration.`,
                );
                ok = false;
            }
            if (dev.devName.includes('..')) {
                this.log.error(
                    `devicename "${dev.devName}"is invalid. Name must not include consecutive dots. Please correct configuration.`,
                );
                ok = false;
            }

            // IPv4, IPv6 address or dns name
            // allowed formats:
            // mynode.domain.com, mynode.domain.com:123 - domainnamen with or without port
            // 1.2.3.4, 1.2.3.4:123 - IPv4 with or without port
            // 8001:1234:ffff::1234 - IPv6 without port
            // [8001:1234:ffff::1234], [8001:1234:ffff::1234]:123 - IPv6 with or without domain name
            this.log.debug(`ip address "${dev.devIpAddr}" will be checked for ${dev.devIp6 ? 'IPv6' : 'IPv4'}`);
            if (dev.devIp6) {
                // IPv6 address or dns name
                const tmp = dev.devIpAddr.match(/^\[([0-9a-fA-F:.]+)\](:\d+)?$/);
                if (tmp) {
                    this.log.debug(`ip address "${dev.devIpAddr}" bracket notation detected`);
                    if (!isIPv6(tmp[1])) {
                        this.log.error(
                            `ip address "${tmp[1]}" is no valid ipv6 address, please correct configuration.`,
                        );
                        ok = false;
                    } else {
                        this.log.debug(`ip address "${dev.devIpAddr}" address check passed`);
                    }
                } else if (/^[0-9a-fA-F:.]+$/.test(dev.devIpAddr)) {
                    this.log.debug(`ip address "${dev.devIpAddr}" plain numeric notation detected`);
                    if (!isIPv6(dev.devIpAddr)) {
                        this.log.error(
                            `ip address "${dev.devIpAddr}" is no valid ipv6 address, please correct configuration.`,
                        );
                        ok = false;
                    } else {
                        this.log.debug(`ip address "${dev.devIpAddr}" address check passed`);
                    }
                } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
                    this.log.debug(`ip address "${dev.devIpAddr}" domain name detected`);
                } else {
                    this.log.error(
                        `ip address "${dev.devIpAddr}" has invalid format for ipv6, please correct configuration.`,
                    );
                    ok = false;
                }
            } else {
                // IPv4 address or dns name
                if (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(dev.devIpAddr)) {
                    this.log.debug(`ip address "${dev.devIpAddr}" numeric notation detected`);
                    const tmp = dev.devIpAddr.split(':');
                    if (!isIPv4(tmp[0])) {
                        this.log.error(
                            `ip address "${dev.devIpAddr}" is no valid ipv4 address, please correct configuration.`,
                        );
                        ok = false;
                    } else {
                        this.log.debug(`ip address "${dev.devIpAddr}" address check passed`);
                    }
                } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
                    this.log.debug(`ip address "${dev.devIpAddr}" domain name detected`);
                } else {
                    this.log.error(
                        `ip address "${dev.devIpAddr}" has invalid format for ipv4, please correct configuration.`,
                    );
                    ok = false;
                }
            }

            /*
             * A device without usable oids is skipped instead of disabling the instance: the oid
             * group of a newly created device is filled in afterwards - with the MIB browser or by
             * hand - and until then the other devices have to keep running.
             *
             * Only the runtime copy of the configuration is changed, the device stays active in the
             * config dialog.
             */
            if (!dev.devOidGroup) {
                this.log.warn(
                    `device "${dev.devName}" (${dev.devIpAddr}) does not specify a oid group and is skipped. Please correct configuration.`,
                );
                dev.devAct = false;
                continue;
            }

            if (!oidSets[dev.devOidGroup]) {
                this.log.warn(
                    `device "${dev.devName}" (${dev.devIpAddr}) references unknown or completly inactive oid group ${dev.devOidGroup} and is skipped. Please correct configuration.`,
                );
                dev.devAct = false;
                continue;
            }

            /*
             * NOTE: at this place the original code checked `dev.authId == ''` for snmp v3 devices,
             * intending to reject a device without authorization id. The attribute is named
             * `devAuthId`, so the check never triggered. Activating it would newly refuse existing
             * v3 configurations, therefore it has to be a separate change - not part of this
             * refactoring.
             */

            if (Number(dev.devSnmpVers) === SNMP_V3 && dev.devAuthId !== '' && !authSets[dev.devAuthId]) {
                this.log.error(
                    `device "${dev.devName}" (${dev.devIpAddr}) references unknown authorization group ${dev.devAuthId}. Please correct configuration.`,
                );
                ok = false;
            }

            if (!/^\d+$/.test(String(dev.devTimeout))) {
                this.log.error(
                    `device "${dev.devName}" - timeout (${dev.devTimeout}) must be numeric, please correct configuration.`,
                );
                ok = false;
            }
            dev.devTimeout = parseInt(String(dev.devTimeout), 10) || 5;
            if (dev.devTimeout > 600) {
                // must be less than 0x7fffffff / 1000
                this.log.warn(
                    `device "${dev.devName}" - device timeout (${dev.devTimeout}) must be less than 600 seconds, please correct configuration.`,
                );
                dev.devTimeout = 600;
                this.log.warn(`device "${dev.devName}" - device timeout set to 600 seconds.`);
            }
            if (dev.devTimeout < 1) {
                this.log.warn(
                    `device "${dev.devName}" - device timeout (${dev.devTimeout}) must be at least 1 second, please correct configuration.`,
                );
                dev.devTimeout = 1;
                this.log.warn(`device "${dev.devName}" - device timeout set to 1 second.`);
            }

            if (!/^\d+$/.test(String(dev.devRetryIntvl))) {
                this.log.error(
                    `device "${dev.devName}" - retry intervall (${dev.devRetryIntvl}) must be numeric, please correct configuration.`,
                );
                ok = false;
            }
            dev.devRetryIntvl = parseInt(String(dev.devRetryIntvl), 10) || 5;
            if (dev.devRetryIntvl > 3600) {
                // must be less than 0x7fffffff / 1000
                this.log.warn(
                    `device "${dev.devName}" - retry intervall (${dev.devRetryIntvl}) must be less than 3600 seconds, please correct configuration.`,
                );
                dev.devRetryIntvl = 3600;
                this.log.warn(`device "${dev.devName}" - retry intervall set to 3600 seconds.`);
            }
            if (dev.devRetryIntvl < 1) {
                this.log.warn(
                    `device "${dev.devName}" - retry intervall (${dev.devRetryIntvl}) must be at least 1 second, please correct configuration.`,
                );
                dev.devRetryIntvl = 1;
                this.log.warn(`device "${dev.devName}" - retry intervall set to 1 second.`);
            }

            if (!/^\d+$/.test(String(dev.devPollIntvl))) {
                this.log.error(
                    `device "${dev.devName}" - poll intervall (${dev.devPollIntvl}) must be numeric, please correct configuration.`,
                );
                ok = false;
            }
            dev.devPollIntvl = parseInt(String(dev.devPollIntvl), 10) || 30;
            if (dev.devPollIntvl > 3600) {
                // must be less than 0x7fffffff / 1000
                this.log.warn(
                    `device "${dev.devName}" - poll intervall (${dev.devPollIntvl}) must be less than 3600 seconds, please correct configuration.`,
                );
                dev.devPollIntvl = 3600;
                this.log.warn(`device "${dev.devName}" - poll intervall set to 3600 seconds.`);
            }
            if (dev.devPollIntvl < 5) {
                this.log.warn(
                    `device "${dev.devName}" - poll intervall (${dev.devPollIntvl}) must be at least 5 seconds, please correct configuration.`,
                );
                dev.devPollIntvl = 5;
                this.log.warn(`device "${dev.devName}" - poll intervall set to 5 seconds.`);
            }
            if (dev.devPollIntvl <= dev.devTimeout) {
                this.log.warn(
                    `device "${dev.devName}" - poll intervall (${dev.devPollIntvl}) must be larger than device timeout (${dev.devTimeout}), please correct configuration.`,
                );
                dev.devPollIntvl = dev.devTimeout + 1;
                this.log.warn(`device "${dev.devName}" - poll intervall set to ${dev.devPollIntvl} seconds.`);
            }
        }

        if (!ok) {
            this.log.debug('validateConfig - validation aborted (checks failed)');
            return false;
        }

        this.log.debug('validateConfig - validation completed (checks passed)');
        return true;
    }

    /**
     * setupContices - setup contices for worker threads
     *
     * One CTX object per active device, see DeviceContext in lib/types.ts.
     */
    private setupContices(): void {
        this.log.debug('setupContices - initializing contices');

        for (let ii = 0, jj = 0; ii < this.config.devs.length; ii++) {
            const dev = this.config.devs[ii];

            if (!dev.devAct) {
                continue;
            }

            this.log.debug(`adding device "${dev.devIpAddr}" (${dev.devName}) , snmp id: ${dev.devSnmpVers}`);
            this.log.debug(
                `timing parameter: timeout ${dev.devTimeout}s , retry ${dev.devRetryIntvl}s, polling ${dev.devPollIntvl}s`,
            );

            const CTX = this.buildDeviceContext(dev);
            this.CTXs[jj] = CTX;

            let cIdx = -1; // chunk index
            let cCnt = 0; // chunk element count

            for (let oo = 0; oo < this.config.oids.length; oo++) {
                const oid = this.config.oids[oo];

                // skip inactive oids and oids belonging to other oid groups
                if (!oid.oidAct) {
                    continue;
                }
                if (dev.devOidGroup !== oid.oidGroup) {
                    continue;
                }

                const { oid: numericOid, id } = this.resolveConfiguredOid(oid, CTX.id);
                if (cCnt <= 0) {
                    cIdx++;
                    CTX.chunks.push({ OIDs: [], oids: [], ids: [] });
                    cCnt = this.chunkSize;
                    this.log.debug(`       oid chunk index ${cIdx} created`);
                }
                CTX.chunks[cIdx].oids.push(numericOid);
                CTX.chunks[cIdx].ids.push(id);
                CTX.chunks[cIdx].OIDs.push(oid);
                cCnt--;

                this.log.debug(`       oid "${oid.oidOid}" (${id})`);
            }

            jj++;
        }
    }

    /**
     * buildDeviceContext - create the runtime context of one configured device
     *
     *		Used by setupContices for the reader threads and by the MIB browser, which needs a
     *		context for a one shot walk of a device.
     *
     * @param dev one row of `native.devs`
     * @returns the device context, without any oids
     */
    private buildDeviceContext(dev: DeviceConfig): DeviceContext {
        let ipAddr = '';
        let ipPort = DEFAULT_SNMP_PORT;
        if (dev.devIp6) {
            // IPv6
            // ffff:0:1234::8abc
            // [ffff:0:1234::8abc] or [ffff:0:1234::8abc]:123
            // mynode.test.com or mynode.test.com:123
            const tmp = dev.devIpAddr.match(/^\[([0-9a-fA-F:.]+)\](:(\d+))?$/);
            if (tmp) {
                // brackated ipv6 with optional port attached
                ipAddr = tmp[1];
                ipPort = tmp[3] ? Number(tmp[3]) : DEFAULT_SNMP_PORT;
            } else if (/^[0-9a-fA-F:.]+$/.test(dev.devIpAddr)) {
                // numeric ipv6 without port attached
                ipAddr = dev.devIpAddr;
                ipPort = DEFAULT_SNMP_PORT;
            } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
                // domain name with optional port attached
                const parts = dev.devIpAddr.split(':');
                ipAddr = parts[0];
                ipPort = parts[1] ? Number(parts[1]) : DEFAULT_SNMP_PORT;
            } else {
                // NOTE: should never occure here
                this.log.error(
                    `ip address "${dev.devIpAddr}" has invalid format for ipv6, please correct configuration.`,
                );
            }
        } else {
            // IPv4
            // 1.2.3.4 or 1.2.3.4:123
            // mynode.test.com or mynode.test.com:123
            const parts = dev.devIpAddr.split(':');
            ipAddr = parts[0];
            ipPort = parts[1] ? Number(parts[1]) : DEFAULT_SNMP_PORT;
        }

        const CTX: DeviceContext = {
            name: dev.devName,
            ipAddr: ipAddr,
            ipPort: ipPort,
            id: dev.devName,
            isIPv6: dev.devIp6,
            timeout: dev.devTimeout * 1000, //s -> ms must be less than 0x7fffffff
            retryIntvl: dev.devRetryIntvl * 1000, //s -> ms must be less than 0x7fffffff
            pollIntvl: dev.devPollIntvl * 1000, //s -> ms must be less than 0x7fffffff
            snmpVers: dev.devSnmpVers,
            authId: dev.devAuthId,
            chunks: [],
            pollTimer: null, // poll intervall timer
            retryTimer: null, // retry timer
            sessCtx: null, // snmp session
            initialized: false, // connection initialization status of device
            online: false, // connection status of device
        };

        if (this.config.optUseName) {
            if (dev.devIp6) {
                this.log.warn(
                    `device "${dev.devIpAddr}" (${dev.devName}) requests ipv6. Option compatibility mode ignored.`,
                );
            } else {
                CTX.id = ip2ipStr(CTX.ipAddr);
            }
        }

        if (Number(dev.devSnmpVers) === SNMP_V3) {
            let authSet: Partial<AuthConfig> = {};
            for (let kk = 0; kk < this.config.authSets.length; kk++) {
                if (this.config.authSets[kk].authId === dev.devAuthId) {
                    authSet = this.config.authSets[kk];
                }
            }
            CTX.authSecLvl = authSet.authSecLvl || 0;
            CTX.authUser = (authSet.authUser || '').trim();
            CTX.authAuthProto = authSet.authAuthProto || 0;
            CTX.authAuthKey = (authSet.authAuthKey || '').trim();
            CTX.authEncProto = authSet.authEncProto || 0;
            CTX.authEncKey = (authSet.authEncKey || '').trim();
        }

        return CTX;
    }

    /**
     * resolveConfiguredOid - numeric oid and state id of one configured oid
     *
     *		Without `optUseMibNames` this is exactly what the adapter has always done: the oid is
     *		used as configured and the state id is derived from `oidName`.
     *
     *		With `optUseMibNames` the oid may be given as a symbolic name (`IF-MIB::ifDescr.1`) and
     *		the state id is derived from the MIB symbol instead of from `oidName`. If no loaded MIB
     *		covers the oid, the configured name is used, so that a single unknown oid does not stop
     *		the whole device.
     *
     * @param pOID one row of `native.oids`
     * @param pDevId id of the device the oid belongs to
     * @returns the numeric oid to request and the full state id to write
     */
    private resolveConfiguredOid(pOID: OidConfig, pDevId: string): { oid: string; id: string } {
        const fallback = {
            oid: pOID.oidOid,
            id: `${pDevId}.${name2id(pOID.oidName, this.FORBIDDEN_CHARS)}`,
        };

        if (!this.config.optUseMibNames) {
            return fallback;
        }

        const resolved = this.mibStore.resolve(pOID.oidOid);
        if (!resolved) {
            // validateConfig already reported this - keep the device running with the raw value
            this.log.warn(`oid "${pOID.oidOid}" cannot be resolved, using it as configured`);
            return fallback;
        }

        if (!resolved.name) {
            this.log.debug(`oid "${pOID.oidOid}" is not covered by a mib, using name "${pOID.oidName}" for the state`);
            return { oid: resolved.oid, id: fallback.id };
        }

        const mibName = resolved.instance ? `${resolved.name}.${resolved.instance}` : resolved.name;
        return { oid: resolved.oid, id: `${pDevId}.${name2id(mibName, this.FORBIDDEN_CHARS)}` };
    }

    // #################### mib handling ####################

    /**
     * syncMibs - materialize the uploaded MIB files on disk and parse them
     *
     *		The files live in the file storage of the `<namespace>.mibs` meta object, because that is
     *		what the file selector of the config dialog writes to. net-snmp's parser can only read
     *		files, and it resolves the IMPORTS of a module relative to the file it is reading, so all
     *		of them are written into one directory below the instance data directory first.
     */
    private async syncMibs(): Promise<void> {
        const metaId = `${this.namespace}.${MIB_META_SUFFIX}`;
        const files: { name: string; data: Buffer | string }[] = [];

        try {
            for (const entry of await this.readDirAsync(metaId, '/')) {
                if (entry.isDir) {
                    continue;
                }
                const file = await this.readFileAsync(metaId, entry.file);
                files.push({ name: entry.file, data: file.file });
            }
        } catch (e) {
            this.log.debug(`no mib files uploaded yet (${(e as Error).message})`);
        }

        this.log.debug(`syncMibs - ${files.length} uploaded mib file(s)`);
        this.mibStore.writeFiles(files);
        this.mibStore.load();
    }

    /** mibModulesResponse - the answer of the mibModules and mibReload commands */
    private mibModulesResponse(): MibModulesResponse {
        return {
            modules: this.mibStore.getModules(),
            errors: this.mibStore.getLoadErrors(),
        };
    }

    /**
     * readChildren - read the direct children of one oid from a device
     *
     *		SNMP cannot list the children of a node, it only reports the value behind an oid. The
     *		children are therefore collected with getNext: the first value below the node names the
     *		first child, a second getNext tells whether that child carries more than this one value,
     *		and the next request starts behind the whole child, so that its subtree is skipped.
     *
     *		That costs two requests per child instead of walking everything below the node, which is
     *		what lets the browser open one folder at a time.
     *
     * @param pCTX context of the device to read
     * @param pOid oid whose children are wanted
     * @returns the children, folders without their content
     */
    private async readChildren(pCTX: DeviceContext, pOid: string): Promise<MibNodesResponse> {
        const sessCtx = snmpCreateSession(pCTX, this.log);
        if (!sessCtx.session) {
            return { nodes: [], error: `cannot open a snmp session for device "${pCTX.name}"` };
        }

        const nodes: MibTreeNode[] = [];
        let truncated = false;

        try {
            let cursor = pOid;

            while (nodes.length < MIB_CHILDREN_LIMIT) {
                const result = await snmpSessionGetNextAsync(sessCtx.session, [cursor], this.log);
                if (result.err) {
                    /*
                     * snmp v1 does not know an "end of mib view": it answers a getNext behind the
                     * last value with the error NoSuchName, which here only means that this level
                     * is complete.
                     */
                    if (result.err.toString().includes('NoSuchName')) {
                        break;
                    }
                    return { nodes, error: result.err.toString() };
                }

                const varbind = result.varbinds[0];
                if (!varbind || isVarbindError(varbind) || !varbind.oid.startsWith(`${pOid}.`)) {
                    // the device left the subtree - there is nothing more below this node
                    break;
                }

                const subId = varbind.oid.slice(pOid.length + 1).split('.')[0];
                const childOid = `${pOid}.${subId}`;
                // the value of the child itself, as opposed to a value somewhere below it
                const single = !varbind.oid.slice(childOid.length + 1).includes('.');

                let more = false;
                if (single) {
                    // an error of the probe means the same as an answer outside the child: no more
                    const probe = await snmpSessionGetNextAsync(sessCtx.session, [varbind.oid], this.log);
                    const next = probe.varbinds[0];
                    more = !!next && !isVarbindError(next) && next.oid.startsWith(`${childOid}.`);
                }

                if (single && !more) {
                    // the browser only displays the values, so the textual format is good enough
                    const decoded = varbindDecode(varbind, F_TEXT, pCTX.id, varbind.oid, this.log);
                    nodes.push(
                        this.mibStore.nodeForVarbind({
                            oid: varbind.oid,
                            value: decoded.val === null ? '' : String(decoded.val),
                            type: oidObjType2Text(varbind.type),
                        }),
                    );

                    // nothing else lives below this child, so the next request continues behind it
                    cursor = varbind.oid;
                } else {
                    nodes.push(this.mibStore.nodeForFolder(childOid));

                    /*
                     * Everything below the child is smaller than "<child>.<largest sub id>", so this
                     * skips the whole subtree with one request. The next sub id of the level must
                     * not be used for that: the rows of a table carry their value at "<column>.<n>"
                     * itself, and a getNext for that oid would jump over the row.
                     */
                    cursor = `${childOid}.${MAX_SUB_ID}`;
                }
            }

            truncated = nodes.length >= MIB_CHILDREN_LIMIT;
            this.log.debug(`readChildren - ${nodes.length} child(ren) of ${pOid} read from "${pCTX.name}"`);

            return { nodes, truncated: truncated || undefined };
        } finally {
            snmpCloseSession(sessCtx, this.log);
        }
    }

    /**
     * valuesOfDevice - every value below one oid, for "take over the whole subtree"
     *
     * @param pDeviceName name of a configured device
     * @param pOid oid to read below
     * @param pDevice a device which is not part of the configuration yet - the setup wizard
     * @returns the values, as a flat list, at most `MIB_SUBTREE_LIMIT` of them
     */
    private async valuesOfDevice(pDeviceName: string, pOid: string, pDevice?: DeviceConfig): Promise<MibNodesResponse> {
        const dev = this.deviceForBrowser(pDeviceName, pDevice);
        if (!dev) {
            return {
                nodes: [],
                error: `device "${pDeviceName}" is unknown - please save the configuration before reading a device`,
            };
        }

        if (!this.mibStore.loaded) {
            await this.syncMibs();
        }

        const resolved = this.mibStore.resolve(pOid);
        if (!resolved) {
            return { nodes: [], error: `oid "${pOid}" cannot be resolved` };
        }

        const CTX = this.buildDeviceContext(dev);
        const sessCtx = snmpCreateSession(CTX, this.log);
        if (!sessCtx.session) {
            return { nodes: [], error: `cannot open a snmp session for device "${CTX.name}"` };
        }

        try {
            const result = await snmpSessionSubtreeAsync(sessCtx.session, resolved.oid, MIB_SUBTREE_LIMIT, this.log);

            // snmp v1 ends the walk with NoSuchName - whatever was collected until then is valid
            if (result.err && !result.err.toString().includes('NoSuchName')) {
                return { nodes: [], error: result.err.toString() };
            }

            const nodes = result.varbinds
                .filter(varbind => !isVarbindError(varbind))
                .map(varbind => {
                    // the browser only displays the values, so the textual format is good enough
                    const decoded = varbindDecode(varbind, F_TEXT, CTX.id, varbind.oid, this.log);
                    return this.mibStore.nodeForVarbind({
                        oid: varbind.oid,
                        value: decoded.val === null ? '' : String(decoded.val),
                        type: oidObjType2Text(varbind.type),
                    });
                });

            this.log.debug(`valuesOfDevice - ${nodes.length} value(s) below ${resolved.oid} read from "${CTX.name}"`);

            return { nodes, truncated: result.truncated || undefined };
        } finally {
            snmpCloseSession(sessCtx, this.log);
        }
    }

    /**
     * childrenOfDevice - the children of one oid, for the MIB browser
     *
     * @param pDeviceName name of a configured device
     * @param pOid oid whose children are wanted
     * @param pDevice a device which is not part of the configuration yet - the setup wizard
     * @returns the children of that oid
     */
    private async childrenOfDevice(
        pDeviceName: string,
        pOid: string,
        pDevice?: DeviceConfig,
    ): Promise<MibNodesResponse> {
        const dev = this.deviceForBrowser(pDeviceName, pDevice);
        if (!dev) {
            return {
                nodes: [],
                error: `device "${pDeviceName}" is unknown - please save the configuration before reading a device`,
            };
        }

        if (!this.mibStore.loaded) {
            await this.syncMibs();
        }

        const resolved = this.mibStore.resolve(pOid);
        if (!resolved) {
            return { nodes: [], error: `oid "${pOid}" cannot be resolved` };
        }

        return this.readChildren(this.buildDeviceContext(dev), resolved.oid);
    }

    /**
     * deviceForBrowser - the device a request of the MIB browser refers to
     *
     * @param pDeviceName name of a configured device
     * @param pDevice a device which is not part of the configuration yet - the setup wizard sends
     *		the whole row, because the instance cannot know a device which has just been entered
     * @returns the device or undefined if the name is unknown
     */
    private deviceForBrowser(pDeviceName: string, pDevice?: DeviceConfig): DeviceConfig | undefined {
        if (pDevice?.devIpAddr) {
            return {
                ...pDevice,
                // a row from the dialog may carry anything in the timings
                devTimeout: Number(pDevice.devTimeout) || 5,
                devRetryIntvl: Number(pDevice.devRetryIntvl) || 5,
                devPollIntvl: Number(pDevice.devPollIntvl) || 30,
            };
        }

        return (this.config.devs || []).find(entry => entry.devName === pDeviceName);
    }

    /**
     * onMessage - answer the sendTo commands of the admin MIB browser
     *
     *		NOTE: these commands are the interface of the MIB browser component. Do not rename them,
     *		the component under src-admin/ calls them by name.
     *
     * @param obj message object
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj?.command) {
            return;
        }

        this.log.debug(`onMessage - command "${obj.command}"`);

        const reply = (response: unknown): void => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, response, obj.callback);
            }
        };

        try {
            switch (obj.command) {
                case 'mibReload': {
                    await this.syncMibs();
                    reply(this.mibModulesResponse());
                    return;
                }

                case 'mibModules': {
                    if (!this.mibStore.loaded) {
                        await this.syncMibs();
                    }
                    reply(this.mibModulesResponse());
                    return;
                }

                case 'mibSubtree': {
                    const request = obj.message as { device?: string; dev?: DeviceConfig; oid?: string };
                    reply(await this.valuesOfDevice(request?.device || '', request?.oid || '', request?.dev));
                    return;
                }

                case 'mibChildren': {
                    const request = obj.message as { device?: string; dev?: DeviceConfig; oid?: string };
                    reply(await this.childrenOfDevice(request?.device || '', request?.oid || '', request?.dev));
                    return;
                }

                default: {
                    this.log.debug(`onMessage - unknown command "${obj.command}"`);
                    reply({ error: `unknown command "${obj.command}"` });
                }
            }
        } catch (e) {
            this.log.error(`onMessage - command "${obj.command}" failed: ${(e as Error).message}`);
            reply({ error: (e as Error).message });
        }
    }

    // #################### adapter main functions ####################
    /**
     * onReady - will be called as soon as adapter is ready
     */
    private async onReady(): Promise<void> {
        this.log.debug('onReady triggered');

        if (DO_INSTALL) {
            const instUtils = new InstallUtils(this);

            this.log.info('performing installation');
            await instUtils.doUpgrade();
            this.log.info('installation completed');

            this.didInstall = true;
            this.terminate('exit after migration of config', utils.EXIT_CODES.NO_ERROR);
            return; // shut down as soon as possible
        }

        {
            const cfgVers = this.config.cfgVers || '0';
            const OIDs = this.config.OIDs;

            if (Number(cfgVers) === 0 || OIDs) {
                const instUtils = new InstallUtils(this);
                this.log.info('performing delayed installation');
                await instUtils.doUpgrade(this.instance);
                this.log.info('installation completed');

                this.didInstall = true;
                if (instUtils.doRestart) {
                    this.terminate('restart after migration of config', utils.EXIT_CODES.NO_ERROR);
                    return; // shut down as soon as possible
                }
            }
        }

        {
            const instUtils = new InstallUtils(this);
            this.log.debug('update check for config');
            await instUtils.doUpdate(this.instance);
            this.log.debug('update check for config completed');

            if (instUtils.doRestart) {
                this.terminate('restart after update of config', utils.EXIT_CODES.NO_ERROR);
                return; // shut down as soon as possible
            }
        }

        // mark adapter as non active
        await this.setStateAsync('info.connection', false, true);

        // read and parse the uploaded mib files - validateConfig needs them to resolve symbolic oids
        await this.syncMibs();

        // validate config
        if (!this.validateConfig()) {
            this.log.error('invalid config, cannot continue');
            void this.disable();
            return;
        }

        // cleanup states
        await this.cleanupStates();

        // read global config
        this.chunkSize = this.config.optChunkSize || 20;
        this.log.info(`adapter initializing, chunk size set to ${this.chunkSize}`);

        // setup worker thread contices
        this.setupContices();

        // init all objects
        await this.initAllObjects();

        this.log.debug('initialization completed');

        // cleanup states
        await this.cleanupStates();

        // start one reader thread per device
        this.log.debug('starting reader threads');
        for (let ii = 0; ii < this.CTXs.length; ii++) {
            const CTX = this.CTXs[ii];
            void this.createReaderSession(CTX);
        }

        // start connection info updater
        this.log.debug('startconnection info updater');
        this.connUpdateTimer = this.setInterval(() => void this.handleConnectionInfo(), 15000) ?? null;

        this.log.debug('startup completed');
    }

    /**
     * onStateChange - called when any state changes
     *
     * @param pFullId full id of the state
     * @param pState state object
     */
    private async onStateChange(pFullId: string, pState: ioBroker.State | null | undefined): Promise<void> {
        this.log.debug(`onStateChange triggered - id ${pFullId}`);

        if (!pState || pState.ack) {
            return;
        }

        this.log.debug(`onStateChange - state id ${pFullId} set to ${pState.val}`);

        if (typeof this.STATEs[pFullId] === 'undefined' || typeof this.STATEs[pFullId].varbind === 'undefined') {
            this.log.warn(`cannot write to uninitialized state ${pFullId}`);
            return;
        }

        const CTX = this.STATEs[pFullId].CTX as DeviceContext;
        const devId = CTX.id;
        const format = this.STATEs[pFullId].format as number;
        const stateId = this.STATEs[pFullId].stateId as string;

        // TODO: if state is set but no connetion is possible, errors occure every x seconds ...
        //       Read erroro trigger onStateChange with ACK-false - must be filtered somehow
        //       Set state only if something hanges (incl. quality) ???

        // prepare varbind to be written
        const varbind = varbindEncode(this.STATEs[pFullId], pState.val, devId, stateId, this.log);

        let sessCtx: SessionContext | null = snmpCreateSession(CTX, this.log);

        if (varbind.value !== null) {
            const resultSet = await snmpSessionSetAsync(sessCtx.session, [varbind], this.log);
            if (resultSet.err) {
                this.log.error(`[${devId}] session.set: ${resultSet.err.toString()}`);
            } else {
                this.log.debug(`[${devId}] session.set: success`);
            }
        } else {
            this.log.warn(`[${devId}] data could not be converted - no data sent`);
        }

        // reread data of device
        const resultGet = await snmpSessionGetAsync(sessCtx.session, [varbind.oid], this.log);
        if (resultGet.varbinds.length === 1) {
            /* should be always one */
            if (isVarbindError(resultGet.varbinds[0])) {
                this.log.error(`[${devId}] session.get: ${varbindError(resultGet.varbinds[0])}`);

                await this.setStates(stateId, { val: null, ack: true, q: 0x84 }); // sensor reports error
            } else {
                void this.processVarbind(CTX, stateId, format, true, resultGet.varbinds[0]);
            }
        } else {
            this.log.error(
                `[${devId}] session.set: invalid number of varbinds returned (${resultGet.varbinds.length})`,
            );
        }

        if (sessCtx) {
            snmpCloseSession(sessCtx, this.log);
            sessCtx = null;
        }
    }

    /**
     * onUnload - called when adapter shuts down
     *
     * @param callback callback function, must be called under all circumstances
     */
    private onUnload(callback: () => void): void {
        this.log.debug('onUnload triggered');

        this.shutdownInProgress = true;

        for (let ii = 0; ii < this.CTXs.length; ii++) {
            const CTX = this.CTXs[ii];

            // (re)set device online status
            try {
                void this.setState(`${CTX.id}.info.error`, { val: false, ack: true, q: 0x00 });
                void this.setState(`${CTX.id}.info.online`, { val: false, ack: true, q: 0x00 });
            } catch {
                /* */
            }

            // close session if one exists
            if (CTX.pollTimer) {
                try {
                    this.clearInterval(CTX.pollTimer);
                } catch {
                    /* */
                }
                CTX.pollTimer = null;
            }

            if (CTX.sessCtx) {
                snmpCloseSession(CTX.sessCtx, this.log);
                CTX.sessCtx = null;
            }
        }

        if (this.connUpdateTimer) {
            try {
                this.clearInterval(this.connUpdateTimer);
            } catch {
                /* */
            }
            this.connUpdateTimer = null;
        }

        try {
            void this.setState('info.connection', false, true);
        } catch {
            /* */
        }

        // callback must be called under all circumstances
        callback();
    }
}

/**
 * here we start
 */
// NOTE: join(',') reproduces the implicit array to string conversion of the JavaScript original
console.log(`DEBUG  : snmp adapter initializing (${process.argv.join(',')}) ...`); //logger not yet initialized

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Snmp(options);
} else {
    // otherwise start the instance directly
    (() => new Snmp())();
}
