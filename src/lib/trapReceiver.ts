/**
 * snmp adapter - receiving snmp traps and informs
 *
 * A trap is the opposite direction of everything else this adapter does: it is not polled, the
 * device sends it when something happens. One udp socket serves the whole instance, and which
 * device a trap belongs to is decided by the address it came from.
 *
 * The three notification types are handled by the same callback: an snmp v1 `Trap`, an snmp v2c
 * `TrapV2` and an `InformRequest`, which net-snmp acknowledges by itself before it hands the
 * notification over.
 */

import * as snmp from 'net-snmp';
import type { User, Varbind } from 'net-snmp';

import { SNMP_V1, SNMP_V2c, SNMP_V3 } from './constants';
import { snmpUserFor, type SnmpV3Auth } from './snmpSession';

/** oid of sysUpTime.0 - the first varbind of every snmp v2c notification */
export const SYS_UP_TIME_OID = '1.3.6.1.2.1.1.3.0';

/** oid of snmpTrapOID.0 - the second varbind of every snmp v2c notification names the trap itself */
export const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';

/** the oids RFC 3584 assigns to the six generic traps of snmp v1 - `<this>.<generic + 1>` */
const GENERIC_TRAP_BASE = '1.3.6.1.6.3.1.1.5';

/** `generic` 6 means that the trap is described by the enterprise oid and the specific code */
const GENERIC_ENTERPRISE_SPECIFIC = 6;

/**
 * The pdu of a notification as net-snmp hands it to the receiver callback.
 *
 * `createReceiver()` is typed as `any` by `@types/net-snmp`, so the shape is declared here to keep
 * the rest of the adapter free of `any` - the same way `lib/mib.ts` declares the module store.
 */
export interface TrapPdu {
    /** one of net-snmp's PduType codes - Trap, TrapV2 or InformRequest */
    type: number;
    varbinds?: Varbind[];
    /** snmp v1 only - the enterprise the trap has been defined by */
    enterprise?: string;
    /** snmp v1 only - the address the sending agent reports for itself */
    agentAddr?: string;
    /** snmp v1 only - 0..5 for the generic traps, 6 for an enterprise specific one */
    generic?: number;
    /** snmp v1 only - the trap number within the enterprise */
    specific?: number;
    /** snmp v1 only - uptime of the sender in hundredths of a second */
    upTime?: number;
    /** community the notification has been sent with (v1, v2c) */
    community?: string;
    /** name of the snmp v3 user the notification has been sent by */
    user?: string;
}

/** One received notification, as the receiver callback gets it */
export interface TrapNotification {
    pdu: TrapPdu;
    rinfo: { address: string; port: number };
}

/**
 * The part of net-snmp's Receiver this adapter uses.
 *
 * See the note on `TrapPdu` - `createReceiver()` has no types.
 */
export interface TrapReceiver {
    getAuthorizer: () => {
        addCommunity: (pCommunity: string) => void;
        addUser: (pUser: User) => void;
    };
    close: (pCallback?: () => void) => void;
}

/** Everything the receiver needs in order to open its socket */
export interface TrapReceiverOptions {
    /** udp port to listen on, 162 by default */
    port: number;
    /** address to bind to, empty for every interface of the host */
    address: string;
    /** true to listen on IPv6 instead of IPv4 */
    isIPv6: boolean;
    /** community accepted for v1 and v2c notifications, empty if none is */
    community: string;
    /** authorization set whose user may send v3 notifications, undefined if none may */
    auth?: SnmpV3Auth;
    /** accept every notification without checking the community resp. the user */
    acceptAll: boolean;
}

/**
 * trapOid - the oid which names what has happened
 *
 *		snmp v2c and inform carry it as the varbind `snmpTrapOID.0`. snmp v1 has no such varbind:
 *		it describes the trap with the fields of its own pdu, and RFC 3584 says how those become
 *		the same oid - the six generic traps are numbered below `1.3.6.1.6.3.1.1.5`, everything
 *		else is `<enterprise>.0.<specific>`. Both versions therefore end up comparable, which is
 *		what a script reacting on a trap needs.
 *
 * @param pPdu pdu of the received notification
 * @returns the numeric oid of the trap, empty if the notification does not name one
 */
export function trapOid(pPdu: TrapPdu): string {
    if (pPdu?.type === snmp.PduType.Trap) {
        const generic = Number(pPdu.generic);

        if (generic >= 0 && generic < GENERIC_ENTERPRISE_SPECIFIC) {
            return `${GENERIC_TRAP_BASE}.${generic + 1}`;
        }

        const enterprise = (pPdu.enterprise || '').replace(/^\./, '');
        if (!enterprise) {
            return '';
        }
        return `${enterprise}.0.${Number(pPdu.specific) || 0}`;
    }

    const varbind = (pPdu?.varbinds || []).find(vb => vb?.oid === SNMP_TRAP_OID);
    return typeof varbind?.value === 'string' ? varbind.value : '';
}

/**
 * trapVersion - which snmp version the notification arrived with
 *
 *		The pdu does not carry the version, but the way the sender identified itself does: only an
 *		snmp v3 message has a user, and only an snmp v1 notification is a `Trap` instead of a
 *		`TrapV2`.
 *
 * @param pPdu pdu of the received notification
 * @returns one of the SNMP_V* constants
 */
export function trapVersion(pPdu: TrapPdu): number {
    if (pPdu?.user) {
        return SNMP_V3;
    }
    return pPdu?.type === snmp.PduType.Trap ? SNMP_V1 : SNMP_V2c;
}

/** One varbind of a received notification, as it appears in the json state */
export interface TrapVarbind {
    /** numeric oid */
    oid: string;
    /** module qualified symbol plus instance, e.g. "IF-MIB::ifIndex.2" - empty if no MIB covers it */
    name: string;
    /** textual snmp object type */
    type: string;
    value: ioBroker.StateValue;
}

/** A received notification as it is written into the json state */
export interface TrapInfo {
    /** numeric oid naming what has happened */
    oid: string;
    /** module qualified symbol of the trap, the numeric oid if no MIB covers it */
    name: string;
    /** one of the SNMP_V* constants */
    version: number;
    /** address the notification came from */
    address: string;
    /** community (v1, v2c) resp. user name (v3) it was sent with */
    sender: string;
    /** true if the notification was an inform, which net-snmp has acknowledged */
    inform: boolean;
    /** uptime of the sender in hundredths of a second, if the notification reports one */
    upTime?: number;
    /** snmp v1 only - the enterprise the trap has been defined by */
    enterprise?: string;
    /** snmp v1 only - the address the sending agent reports for itself */
    agentAddr?: string;
    /** snmp v1 only - 0..5 for the generic traps, 6 for an enterprise specific one */
    generic?: number;
    /** snmp v1 only - the trap number within the enterprise */
    specific?: number;
    /** every varbind of the notification, in the order it arrived */
    varbinds: TrapVarbind[];
}

/**
 * trapUpTime - how long the sender had been running when it sent the notification
 *
 *		snmp v1 carries it in the pdu, snmp v2c as the varbind `sysUpTime.0`.
 *
 * @param pPdu pdu of the received notification
 * @returns hundredths of a second, undefined if the notification does not report it
 */
export function trapUpTime(pPdu: TrapPdu): number | undefined {
    if (typeof pPdu?.upTime === 'number') {
        return pPdu.upTime;
    }

    const varbind = (pPdu?.varbinds || []).find(vb => vb?.oid === SYS_UP_TIME_OID);
    return typeof varbind?.value === 'number' ? varbind.value : undefined;
}

/**
 * normalizeTrapAddress - the address of a sender in the notation the configuration uses
 *
 *		A socket bound to IPv6 reports an IPv4 sender as "::ffff:192.168.1.5", which would never
 *		match the address the device is configured with.
 *
 * @param pAddress address as the socket reports it
 * @returns the address without an IPv4 mapping prefix
 */
export function normalizeTrapAddress(pAddress: string): string {
    return (pAddress || '').trim().replace(/^::ffff:/i, '');
}

/**
 * deviceForTrapAddress - which of the configured devices a notification came from
 *
 *		A trap names no device, it just arrives - so the address it came from decides. A relay
 *		which forwards the traps of other devices puts the original sender into `agentAddr` of an
 *		snmp v1 trap, which is looked at second.
 *
 * @param pDevices the active devices with the address each of them is configured with
 * @param pAddress address the notification came from
 * @param pAgentAddr address the sending agent reports for itself, empty if it reports none
 * @returns the device, or undefined if none of them uses one of the two addresses
 */
export function deviceForTrapAddress<T extends { ipAddr: string }>(
    pDevices: T[],
    pAddress: string,
    pAgentAddr: string,
): T | undefined {
    const address = normalizeTrapAddress(pAddress);
    const agent = normalizeTrapAddress(pAgentAddr);

    const byAddress = address ? pDevices.find(device => device?.ipAddr === address) : undefined;
    if (byAddress || !agent || agent === address) {
        return byAddress;
    }

    return pDevices.find(device => device?.ipAddr === agent);
}

/**
 * trapSender - how the notification identified itself
 *
 * @param pPdu pdu of the received notification
 * @returns the community (v1, v2c) resp. the user name (v3), empty if neither is known
 */
export function trapSender(pPdu: TrapPdu): string {
    return pPdu?.community || pPdu?.user || '';
}

/**
 * trapIsInform - true if the notification expects to be acknowledged
 *
 *		net-snmp answers an inform by itself before the callback is called, so this is information
 *		for the log and for the json, nothing has to be sent here.
 *
 * @param pPdu pdu of the received notification
 * @returns true for an InformRequest
 */
export function trapIsInform(pPdu: TrapPdu): boolean {
    return pPdu?.type === snmp.PduType.InformRequest;
}

/**
 * createTrapReceiver - open the udp socket traps are received on
 *
 *		The socket is bound asynchronously: a port which is already in use or which the process is
 *		not allowed to bind (162 is privileged on linux) is not reported here but as an error to
 *		`pCallback`.
 *
 * @param pOptions what to listen on and what to accept
 * @param pCallback called for every notification and for every error of the socket
 * @param pLog logger
 * @returns the receiver, or null if it could not even be created
 */
export function createTrapReceiver(
    pOptions: TrapReceiverOptions,
    pCallback: (pError: Error | null, pTrap?: TrapNotification) => void,
    pLog: ioBroker.Logger,
): TrapReceiver | null {
    const transport = pOptions.isIPv6 ? 'udp6' : 'udp4';

    pLog.debug(
        `createTrapReceiver - listening on ${pOptions.address || '*'}:${pOptions.port} (${transport}), ` +
            `authorization ${pOptions.acceptAll ? 'disabled' : 'enabled'}`,
    );

    let receiver: TrapReceiver;
    try {
        receiver = snmp.createReceiver(
            {
                port: pOptions.port,
                address: pOptions.address || null,
                transport: transport,
                disableAuthorization: pOptions.acceptAll,
                // so that the community resp. the user name reaches the callback and the log
                includeAuthentication: true,
            },
            pCallback,
        ) as TrapReceiver;
    } catch (e) {
        pLog.error(`cannot listen for traps on port ${pOptions.port}, ${(e as Error).message}`);
        return null;
    }

    const authorizer = receiver.getAuthorizer();

    if (pOptions.community) {
        authorizer.addCommunity(pOptions.community);
    }
    if (pOptions.auth) {
        const user = snmpUserFor(pOptions.auth);
        // the keys never belong into the log, the user name is what a rejected trap is about
        pLog.debug(`createTrapReceiver - accepting snmp v3 traps of user "${user.name}"`);
        authorizer.addUser(user);
    }

    return receiver;
}

/**
 * closeTrapReceiver - give the udp socket back
 *
 * @param pReceiver the receiver to close
 * @param pLog logger
 */
export function closeTrapReceiver(pReceiver: TrapReceiver, pLog: ioBroker.Logger): void {
    try {
        pReceiver.close();
    } catch (e) {
        pLog.warn(`cannot close the trap receiver, ${(e as Error).message}`);
    }
}
