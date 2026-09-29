/**
 * snmp adapter - internal types
 *
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 */

import type { ObjectType, Session, Varbind, VarbindValue } from 'net-snmp';

/**
 * One row of `native.oids` (tab "OID sets" of the config dialog).
 *
 * NOTE: numeric fields may arrive as strings from older configurations, therefore all
 * comparisons in the adapter normalize them with `Number()` before comparing.
 */
export interface OidConfig {
    oidAct: boolean;
    oidGroup: string;
    oidName: string;
    oidOid: string;
    /** one of the F_* constants */
    oidFormat: number;
    oidWriteable: boolean;
    oidOptional: boolean;
}

/** One row of `native.devs` (tab "Devices" of the config dialog) */
export interface DeviceConfig {
    devAct: boolean;
    devName: string;
    /** hostname, IPv4 or IPv6 address, optionally with ":<port>" appended */
    devIpAddr: string;
    devIp6: boolean;
    devOidGroup: string;
    /** one of the SNMP_V* constants - may be a string in old configurations */
    devSnmpVers: number | string;
    /** community (v1, v2c) resp. id of the authorization set (v3) */
    devAuthId: string;
    /** seconds */
    devTimeout: number;
    /** seconds */
    devRetryIntvl: number;
    /** seconds */
    devPollIntvl: number;
}

/** One row of `native.authSets` (tab "Authorization" of the config dialog) */
export interface AuthConfig {
    authId: string;
    /** 1 = minimum, 2 = authentication, 3 = authentication + encryption */
    authSecLvl: number | string;
    authUser: string;
    /** one of the MD5 / SHA* constants */
    authAuthProto: number | string;
    authAuthKey: string;
    /** one of the DES / AES* constants */
    authEncProto: number | string;
    authEncKey: string;
}

/** A group of OIDs which is read with a single snmp get request */
export interface OidChunk {
    /** oid configuration objects (contains i.e. flags) */
    OIDs: OidConfig[];
    /** oids to be read */
    oids: string[];
    /** ids of the states for the oids to be read (index synced with `oids`) */
    ids: string[];
}

/** A snmp session together with the device it has been created for */
export interface SessionContext {
    session: Session | null;
    name: string;
    ipAddr: string;
}

/**
 * Runtime context of one single device - referred to as CTX throughout the adapter.
 */
export interface DeviceContext {
    /** name of the device */
    name: string;
    /** ip address or hostname (without port number) */
    ipAddr: string;
    /** ip port number */
    ipPort: number;
    /** id of the device, derived from name or - with optUseName - from the ip address */
    id: string;
    /** true if IPv6 is to be used */
    isIPv6: boolean;
    /** snmp connect timeout (ms) */
    timeout: number;
    /** snmp retry interval (ms) */
    retryIntvl: number;
    /** snmp poll interval (ms) */
    pollIntvl: number;
    /** snmp version - one of the SNMP_V* constants */
    snmpVers: number | string;
    /** snmp community (v1, v2c) resp. id of the authorization set (v3) */
    authId: string;

    /* the following attributes are filled for snmp v3 devices only */
    authSecLvl?: number | string;
    authUser?: string;
    authAuthProto?: number | string;
    authAuthKey?: string;
    authEncProto?: number | string;
    authEncKey?: string;

    /** oids to read, split into chunks of at most `optChunkSize` entries */
    chunks: OidChunk[];
    /** poll interval timer */
    pollTimer: ioBroker.Interval | null;
    /** retry timer */
    retryTimer: ioBroker.Timeout | null;
    /** active snmp session */
    sessCtx: SessionContext | null;
    /** true as soon as the connection state has been reported once */
    initialized: boolean;
    /** true if the device is reachable */
    online: boolean;
}

/** Result of `varbindDecode` */
export interface DecodedVarbind {
    val: ioBroker.StateValue;
    /** textual representation of the snmp object type */
    typeStr: string;
    /** ioBroker state quality code */
    qual: ioBroker.State['q'];
    /** the F_* format the value has finally been converted to */
    format: number;
}

/** The subset of a varbind which is remembered to write a value back */
export interface CachedVarbind {
    oid: string;
    type?: ObjectType;
    value: VarbindValue;
}

/**
 * One entry of the state cache, keyed by the full state id.
 *
 * NOTE: this cache is deliberately used for two different purposes under the same key, exactly
 * as in the JavaScript original: `initObject()` remembers the `common.type` it last saw, while
 * `processVarbind()` remembers what `onStateChange()` needs in order to write a value back.
 * Both overwrite each other's entry, so every attribute has to be optional. Do not "simplify"
 * this without re-checking `onStateChange()`, which reports "cannot write to uninitialized
 * state" whenever `varbind` happens to be missing.
 */
export interface StateCacheEntry {
    type?: ioBroker.ObjectType;
    commonType?: ioBroker.CommonType | null;
    CTX?: DeviceContext;
    stateId?: string;
    format?: number;
    varbind?: CachedVarbind;
}

/** Result of the promisified snmp get / set calls */
export interface SnmpResult {
    err: Error | string | null;
    varbinds: Varbind[];
}
