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
 * snmpSessionGetAsync - async version of snmp.session.get
 *
 * @param pSession snmp session reference
 * @param pOids snmp oids array
 * @param pLog logger
 * @returns object containing { err, varbinds } as returned by snmp.session.get
 */
export async function snmpSessionGetAsync(
    pSession: Session | null,
    pOids: string[],
    pLog: ioBroker.Logger,
): Promise<SnmpResult> {
    return new Promise<SnmpResult>(resolve => {
        const ret: SnmpResult = {
            err: null,
            varbinds: [],
        };

        if (!pSession) {
            pLog.debug('session vanished, skipping get oparation');
            ret.err = 'no active session';
            resolve(ret);
        } else {
            pSession.get(pOids, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds ?? [];
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
 * @returns object containing { err, varbinds } as returned by snmp.session.set
 */
export async function snmpSessionSetAsync(
    pSession: Session | null,
    pVarbinds: Varbind[],
    pLog: ioBroker.Logger,
): Promise<SnmpResult> {
    return new Promise<SnmpResult>(resolve => {
        const ret: SnmpResult = {
            err: null,
            varbinds: [],
        };

        if (!pSession) {
            pLog.debug('session vanished, skipping set operation');
            ret.err = 'no active session';
            resolve(ret);
        } else {
            pSession.set(pVarbinds, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds ?? [];
                resolve(ret);
            });
        }
    });
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
        // NOTE: 0 is not a valid snmp security level. It is kept as the initial value - as in the
        // JavaScript original - so that an invalid configuration reaches net-snmp unchanged.
        let snmpSecurityLevel = 0 as SecurityLevel;
        const authSecLvl = Number(pCTX.authSecLvl);
        if (authSecLvl === 1) {
            snmpSecurityLevel = snmp.SecurityLevel.noAuthNoPriv; // no message authentication or encryption
        } else if (authSecLvl === 2) {
            snmpSecurityLevel = snmp.SecurityLevel.authNoPriv; // message authentication and no encryption
        } else if (authSecLvl === 3) {
            snmpSecurityLevel = snmp.SecurityLevel.authPriv; //for message authentication and encryption
        }

        let snmpAuthProtocol = 0 as AuthProtocols;
        switch (Number(pCTX.authAuthProto) /* ensure numeric type */) {
            default:
                // see the note on snmpSecurityLevel - 0 is not a valid protocol code
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
        const authEncProto = Number(pCTX.authEncProto);
        if (authEncProto === DES) {
            snmpPrivProtocol = snmp.PrivProtocols.des; // DES encryption
        } else if (authEncProto === AES) {
            snmpPrivProtocol = snmp.PrivProtocols.aes; // AES encryption
        } else if (authEncProto === AES256B) {
            snmpPrivProtocol = snmp.PrivProtocols.aes256b; // AES encryption
        } else if (authEncProto === AES256R) {
            snmpPrivProtocol = snmp.PrivProtocols.aes256r; // AES encryption
        }

        const snmpUser: User = {
            name: pCTX.authUser ?? '',
            level: snmpSecurityLevel,
            authProtocol: snmpAuthProtocol,
            authKey: pCTX.authAuthKey,
            privProtocol: snmpPrivProtocol,
            privKey: pCTX.authEncKey,
        };

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
 * @returns object containing { err, varbinds } and whether the walk has been cut off
 */
export async function snmpSessionSubtreeAsync(
    pSession: Session | null,
    pOid: string,
    pMaxCount: number,
    pLog: ioBroker.Logger,
): Promise<SnmpResult & { truncated: boolean }> {
    return new Promise<SnmpResult & { truncated: boolean }>(resolve => {
        const ret: SnmpResult & { truncated: boolean } = {
            err: null,
            varbinds: [],
            truncated: false,
        };

        if (!pSession) {
            pLog.debug('session vanished, skipping subtree operation');
            ret.err = 'no active session';
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
 * @returns object containing { err, varbinds } as returned by snmp.session.getNext
 */
export async function snmpSessionGetNextAsync(
    pSession: Session | null,
    pOids: string[],
    pLog: ioBroker.Logger,
): Promise<SnmpResult> {
    return new Promise<SnmpResult>(resolve => {
        const ret: SnmpResult = {
            err: null,
            varbinds: [],
        };

        if (!pSession) {
            pLog.debug('session vanished, skipping getNext operation');
            ret.err = 'no active session';
            resolve(ret);
        } else {
            pSession.getNext(pOids, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds ?? [];
                resolve(ret);
            });
        }
    });
}
