/**
 * snmp adapter - snmp session handling
 *
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 */

import * as snmp from 'net-snmp';
import type { AuthProtocols, PrivProtocols, SecurityLevel, Session, User, Varbind } from 'net-snmp';

import {
    AES,
    AES256B,
    AES256R,
    DES,
    MD5,
    SHA,
    SHA224,
    SHA256,
    SHA384,
    SHA512,
    SNMP_V1,
    SNMP_V2c,
    SNMP_V3,
} from './constants';
import type { DeviceContext, SessionContext, SnmpResult } from './types';

/**
 * snmpTrace - one line of the request/answer trace
 *
 *		The trace is switched on per instance with the option `optTrace` and is meant for a support
 *		case: it writes what really goes over the wire, which no other log line shows. The caller
 *		passes the device it is talking to, `undefined` switches the trace off.
 *
 * @param pLog logger
 * @param pDevice id of the device, undefined if the trace is switched off
 * @param pWhat what is being dumped, e.g. "get request"
 * @param pData the request resp. the answer
 */
function snmpTrace(pLog: ioBroker.Logger, pDevice: string | undefined, pWhat: string, pData: unknown): void {
    if (!pDevice) {
        return;
    }

    // a varbind carries Buffer values - JSON.stringify writes them as {"type":"Buffer","data":[…]}
    pLog.info(`[trace] [${pDevice}] ${pWhat} ${JSON.stringify(pData)}`);
}

/**
 * snmpSessionGetAsync - async version of snmp.session.get
 *
 * @param pSession snmp session reference
 * @param pOids snmp oids array
 * @param pLog logger
 * @param pTraceDevice device id to write the trace for, undefined if the trace is off
 * @returns object containing { err, varbinds } as returned by snmp.session.get
 */
export async function snmpSessionGetAsync(
    pSession: Session | null,
    pOids: string[],
    pLog: ioBroker.Logger,
    pTraceDevice?: string,
): Promise<SnmpResult> {
    return new Promise<SnmpResult>(resolve => {
        const ret: SnmpResult = {
            err: null,
            varbinds: [],
        };

        snmpTrace(pLog, pTraceDevice, 'get request', pOids);

        if (!pSession) {
            pLog.debug('session vanished, skipping get oparation');
            ret.err = 'no active session';
            snmpTrace(pLog, pTraceDevice, 'get answer', ret);
            resolve(ret);
        } else {
            pSession.get(pOids, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds ?? [];
                snmpTrace(pLog, pTraceDevice, 'get answer', { err: error?.toString(), varbinds: ret.varbinds });
                resolve(ret);
            });
        }
    });
}

/**
 * snmpSessionSetAsync - async version of snmp.session.set
 *
 * @param pSession snmp session reference
 * @param pVarbinds snmp varbinds array
 * @param pLog logger
 * @param pTraceDevice device id to write the trace for, undefined if the trace is off
 * @returns object containing { err, varbinds } as returned by snmp.session.set
 */
export async function snmpSessionSetAsync(
    pSession: Session | null,
    pVarbinds: Varbind[],
    pLog: ioBroker.Logger,
    pTraceDevice?: string,
): Promise<SnmpResult> {
    return new Promise<SnmpResult>(resolve => {
        const ret: SnmpResult = {
            err: null,
            varbinds: [],
        };

        snmpTrace(pLog, pTraceDevice, 'set request', pVarbinds);

        if (!pSession) {
            pLog.debug('session vanished, skipping set operation');
            ret.err = 'no active session';
            snmpTrace(pLog, pTraceDevice, 'set answer', ret);
            resolve(ret);
        } else {
            pSession.set(pVarbinds, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds ?? [];
                snmpTrace(pLog, pTraceDevice, 'set answer', { err: error?.toString(), varbinds: ret.varbinds });
                resolve(ret);
            });
        }
    });
}

/**
 * The authorization data an snmp v3 user is built from.
 *
 * A `DeviceContext` carries it (copied there from the authorization set of the device) and so does
 * a row of `native.authSets`, so both can be turned into a user - the reader sessions do it for
 * their device, the trap receiver for the user which is allowed to send traps.
 */
export interface SnmpV3Auth {
    /** 1 = minimum, 2 = authentication, 3 = authentication + encryption */
    authSecLvl?: number | string;
    authUser?: string;
    /** one of the MD5 / SHA* constants */
    authAuthProto?: number | string;
    authAuthKey?: string;
    /** one of the DES / AES* constants */
    authEncProto?: number | string;
    authEncKey?: string;
}

/**
 * snmpUserFor - the net-snmp user of an authorization set
 *
 *		NOTE: 0 is not a valid snmp security level resp. protocol code. It is kept as the initial
 *		value - as in the JavaScript original - so that an invalid configuration reaches net-snmp
 *		unchanged instead of being silently turned into something which happens to work.
 *
 * @param pAuth authorization data, from a device context or from an authorization set
 * @returns the user as net-snmp expects it
 */
export function snmpUserFor(pAuth: SnmpV3Auth): User {
    let snmpSecurityLevel = 0 as SecurityLevel;
    const authSecLvl = Number(pAuth.authSecLvl);
    if (authSecLvl === 1) {
        snmpSecurityLevel = snmp.SecurityLevel.noAuthNoPriv; // no message authentication or encryption
    } else if (authSecLvl === 2) {
        snmpSecurityLevel = snmp.SecurityLevel.authNoPriv; // message authentication and no encryption
    } else if (authSecLvl === 3) {
        snmpSecurityLevel = snmp.SecurityLevel.authPriv; //for message authentication and encryption
    }

    let snmpAuthProtocol = 0 as AuthProtocols;
    switch (Number(pAuth.authAuthProto) /* ensure numeric type */) {
        default:
            snmpAuthProtocol = 0 as AuthProtocols;
            break;
        case MD5:
            snmpAuthProtocol = snmp.AuthProtocols.md5;
            break;
        case SHA:
            snmpAuthProtocol = snmp.AuthProtocols.sha;
            break;
        case SHA224:
            snmpAuthProtocol = snmp.AuthProtocols.sha224;
            break;
        case SHA256:
            snmpAuthProtocol = snmp.AuthProtocols.sha256;
            break;
        case SHA384:
            snmpAuthProtocol = snmp.AuthProtocols.sha384;
            break;
        case SHA512:
            snmpAuthProtocol = snmp.AuthProtocols.sha512;
            break;
    }

    let snmpPrivProtocol = 0 as PrivProtocols;
    const authEncProto = Number(pAuth.authEncProto);
    if (authEncProto === DES) {
        snmpPrivProtocol = snmp.PrivProtocols.des; // DES encryption
    } else if (authEncProto === AES) {
        snmpPrivProtocol = snmp.PrivProtocols.aes; // AES encryption
    } else if (authEncProto === AES256B) {
        snmpPrivProtocol = snmp.PrivProtocols.aes256b; // AES encryption
    } else if (authEncProto === AES256R) {
        snmpPrivProtocol = snmp.PrivProtocols.aes256r; // AES encryption
    }

    return {
        name: pAuth.authUser ?? '',
        level: snmpSecurityLevel,
        authProtocol: snmpAuthProtocol,
        authKey: pAuth.authAuthKey,
        privProtocol: snmpPrivProtocol,
        privKey: pAuth.authEncKey,
    };
}

/**
 * snmpCreateSession - initializes a snmp session
 *
 * @param pCTX CTX object
 * @param pLog logger
 * @returns session context object
 *
 * var options = {
 *     port: 161,
 *     retries: 1,
 *     timeout: 5000,
 *     backoff: 1.0,
 *     transport: "udp4",
 *     trapPort: 162,
 *     version: snmp.Version1,
 *     backwardsGetNexts: true,
 *     idBitsSize: 32
 * };
 */
export function snmpCreateSession(pCTX: DeviceContext, pLog: ioBroker.Logger): SessionContext {
    pLog.debug(`snmpCreateSession - device ${pCTX.name} (${pCTX.ipAddr})`);

    const ret: SessionContext = {
        session: null,
        name: pCTX.name,
        ipAddr: pCTX.ipAddr,
    };

    const snmpVers = Number(pCTX.snmpVers);

    // create snmp session for device
    if (snmpVers === SNMP_V1 || snmpVers === SNMP_V2c) {
        const snmpTransport = pCTX.isIPv6 ? 'udp6' : 'udp4';
        const snmpVersion = snmpVers === SNMP_V1 ? snmp.Version1 : snmp.Version2c;

        ret.session = snmp.createSession(pCTX.ipAddr, pCTX.authId, {
            port: pCTX.ipPort, // default:161
            retries: 1,
            timeout: pCTX.timeout,
            backoff: 1.0,
            transport: snmpTransport,
            //trapPort: 162,
            version: snmpVersion,
            backwardsGetNexts: true,
            idBitsSize: 32,
        });
    } else if (snmpVers === SNMP_V3) {
        const snmpUser = snmpUserFor(pCTX);

        // the keys never belong into the log, the user name is what a failed authorization is about
        pLog.debug(
            `snmpCreateSession - device ${pCTX.name} asks as snmp v3 user "${snmpUser.name}", security level ${snmpUser.level}`,
        );

        const snmpTransport = pCTX.isIPv6 ? 'udp6' : 'udp4';
        const snmpVersion = snmp.Version3;
        // ??? engineID: "8000B98380XXXXXXXXXXXXXXXXXXXXXXXX", // where the X's are random hex digits

        ret.session = snmp.createV3Session(pCTX.ipAddr, snmpUser, {
            port: pCTX.ipPort, // default:161
            retries: 1,
            timeout: pCTX.timeout,
            backoff: 1.0,
            transport: snmpTransport,
            //trapPort: 162,
            version: snmpVersion,
            backwardsGetNexts: true,
            idBitsSize: 32,
            context: '',
        });
    } else {
        pLog.error(`unsupported snmp version code (${pCTX.snmpVers}) for device "${pCTX.name}" (${pCTX.ipAddr})`);
    }

    pLog.debug(`session for device "${pCTX.name}" (${pCTX.ipAddr})${ret.session ? '' : ' NOT'} created`);

    return ret;
}

/**
 * snmpCloseSession - close a snmp session
 *
 * @param pSessCtx session object
 * @param pLog logger
 */
export function snmpCloseSession(pSessCtx: SessionContext, pLog: ioBroker.Logger): void {
    pLog.debug(`snmpCloseSession - device ${pSessCtx.name} (${pSessCtx.ipAddr}`);

    if (pSessCtx.session) {
        try {
            pSessCtx.session.close();
        } catch (e) {
            pLog.warn(`cannot close session for device "${pSessCtx.name}" (${pSessCtx.ipAddr}), ${e}`);
        }
        pSessCtx.session = null;
    }
}

/**
 * snmpSessionSubtreeAsync - async version of snmp.session.subtree
 *
 * Used when the user takes over a whole subtree: everything below the oid is wanted, so one walk is
 * cheaper than the level by level reading the browser does otherwise.
 *
 * @param pSession snmp session reference
 * @param pOid oid to walk
 * @param pMaxCount maximum number of varbinds to collect
 * @param pLog logger
 * @param pTraceDevice device id to write the trace for, undefined if the trace is off
 * @returns object containing { err, varbinds } and whether the walk has been cut off
 */
export async function snmpSessionSubtreeAsync(
    pSession: Session | null,
    pOid: string,
    pMaxCount: number,
    pLog: ioBroker.Logger,
    pTraceDevice?: string,
): Promise<SnmpResult & { truncated: boolean }> {
    return new Promise<SnmpResult & { truncated: boolean }>(resolve => {
        const ret: SnmpResult & { truncated: boolean } = {
            err: null,
            varbinds: [],
            truncated: false,
        };

        snmpTrace(pLog, pTraceDevice, 'subtree request', { oid: pOid, maxCount: pMaxCount });

        if (!pSession) {
            pLog.debug('session vanished, skipping subtree operation');
            ret.err = 'no active session';
            snmpTrace(pLog, pTraceDevice, 'subtree answer', ret);
            resolve(ret);
            return;
        }

        pSession.subtree(
            pOid,
            (varbinds: Varbind[]): void => {
                for (const varbind of varbinds) {
                    if (ret.varbinds.length >= pMaxCount) {
                        ret.truncated = true;
                        return;
                    }
                    ret.varbinds.push(varbind);
                }
            },
            (error: Error | null): void => {
                ret.err = error;
                snmpTrace(pLog, pTraceDevice, 'subtree answer', {
                    err: error?.toString(),
                    truncated: ret.truncated,
                    varbinds: ret.varbinds,
                });
                resolve(ret);
            },
        );
    });
}

/**
 * snmpSessionGetNextAsync - async version of snmp.session.getNext
 *
 * Used by the MIB browser to walk one level at a time: snmp cannot list the children of a node, it
 * can only report the value behind a given oid.
 *
 * @param pSession snmp session reference
 * @param pOids snmp oids array
 * @param pLog logger
 * @param pTraceDevice device id to write the trace for, undefined if the trace is off
 * @returns object containing { err, varbinds } as returned by snmp.session.getNext
 */
export async function snmpSessionGetNextAsync(
    pSession: Session | null,
    pOids: string[],
    pLog: ioBroker.Logger,
    pTraceDevice?: string,
): Promise<SnmpResult> {
    return new Promise<SnmpResult>(resolve => {
        const ret: SnmpResult = {
            err: null,
            varbinds: [],
        };

        snmpTrace(pLog, pTraceDevice, 'getNext request', pOids);

        if (!pSession) {
            pLog.debug('session vanished, skipping getNext operation');
            ret.err = 'no active session';
            snmpTrace(pLog, pTraceDevice, 'getNext answer', ret);
            resolve(ret);
        } else {
            pSession.getNext(pOids, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds ?? [];
                snmpTrace(pLog, pTraceDevice, 'getNext answer', { err: error?.toString(), varbinds: ret.varbinds });
                resolve(ret);
            });
        }
    });
}
