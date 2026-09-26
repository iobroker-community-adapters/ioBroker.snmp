/**
 * snmp adapter - varbind conversion functions
 *
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 */

/*
 * Remark related to REAL / FLOAT values returned:
 *
 * see http://www.net-snmp.org/docs/mibs/NET-SNMP-TC.txt
 *
 * --
 * -- Define the Float Textual Convention
 * --   This definition was written by David Perkins.
 * --
 *
 * Float ::= TEXTUAL-CONVENTION
 *     STATUS      current
 *     DESCRIPTION
 *         "A single precision floating-point number.  The semantics
 *          and encoding are identical for type 'single' defined in
 *          IEEE Standard for Binary Floating-Point,
 *          ANSI/IEEE Std 754-1985.
 *          The value is restricted to the BER serialization of
 *          the following ASN.1 type:
 *              FLOATTYPE ::= [120] IMPLICIT FloatType
 *          (note: the value 120 is the sum of '30'h and '48'h)
 *          The BER serialization of the length for values of
 *          this type must use the definite length, short
 *          encoding form.
 *
 *          For example, the BER serialization of value 123
 *          of type FLOATTYPE is '9f780442f60000'h.  (The tag
 *          is '9f78'h; the length is '04'h; and the value is
 *          '42f60000'h.) The BER serialization of value
 *          '9f780442f60000'h of data type Opaque is
 *          '44079f780442f60000'h. (The tag is '44'h; the length
 *          is '07'h; and the value is '9f780442f60000'h.)"
 *     SYNTAX Opaque (SIZE (7))
 *
 */

import { ObjectType, type Varbind } from 'net-snmp';

import { F_AUTO, F_BOOLEAN, F_JSON, F_NUMERIC, F_TEXT } from './constants';
import type { CachedVarbind, DecodedVarbind, StateCacheEntry } from './types';
import { oidObjType2Text } from './utils';

/**
 * varbindDecode - convert varbind data to native data
 *
 * @param pVarbind varbind to decode
 * @param pFormat format constant
 * @param pDevId id of device
 * @param pStateId id of state
 * @param pLog logger
 * @returns state object containing val, typestr and qual values
 */
export function varbindDecode(
    pVarbind: Varbind,
    pFormat: number,
    pDevId: string,
    pStateId: string,
    pLog: ioBroker.Logger,
): DecodedVarbind {
    pLog.debug('varbindDeode - decode varbind');

    // taken from https://github.com/markabrahams/node-net-snmp#oid-strings--varbinds
    // varbind data is encoded based on snmp.ObjectType object.
    //
    // The JavaScript true and false keywords are used for the values of varbinds with type Boolean.
    //
    // All integer based types are specified as expected (this includes Integer, Counter, Gauge, TimeTicks, Integer32,
    // Counter32, Gauge32, and Unsigned32), e.g. -128 or 100.
    //
    // Since JavaScript does not offer full 64 bit integer support objects with type Counter64 cannot be supported in the same way
    // as other integer types, instead Node.js Buffer objects are used. Users are responsible for producing (i.e. for set() requests)
    // and consuming (i.e. the varbinds passed to callback functions) Buffer objects. That is, this module does not work with
    // 64 bit integers, it simply treats them as opaque Buffer objects.
    //
    // Dotted decimal strings are used for the values of varbinds with type OID, e.g. 1.3.6.1.2.1.1.5.0.
    //
    // Dotted quad formatted strings are used for the values of varbinds with type IpAddress, e.g. 192.168.1.1.
    //
    // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
    // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
    //
    // The NoSuchObject, NoSuchInstance and EndOfMibView types are used to indicate an error condition. Currently there is
    // no reason for users of this module to to build varbinds using these types.
    //

    const retval: DecodedVarbind = {
        val: null,
        typeStr: oidObjType2Text(pVarbind.type),
        qual: 0x00, // assume OK
        format: pFormat,
    };
    //

    switch (pVarbind.type) {
        // The JavaScript true and false keywords are used for the values of varbinds with type Boolean.
        case ObjectType.Boolean: {
            const value = pVarbind.value as boolean;
            switch (pFormat) {
                case F_TEXT /* 0 */:
                default:
                    retval.val = String(value);
                    break;
                case F_NUMERIC /* 1 */:
                    retval.val = value ? 1 : 0;
                    break;
                case F_BOOLEAN /* 2 */:
                case F_AUTO /* 99 */:
                    retval.val = value;
                    retval.format = F_BOOLEAN;
                    break;
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify({ type: 'boolean', data: value });
                    break;
            }
            break;
        }

        // All integer based types are specified as expected
        case ObjectType.Integer:
        case ObjectType.Counter:
        case ObjectType.Gauge:
        case ObjectType.TimeTicks:
        case ObjectType.Integer32:
        case ObjectType.Counter32:
        case ObjectType.Gauge32:
        case ObjectType.Unsigned32: {
            const value = pVarbind.value as number;
            switch (pFormat) {
                case F_TEXT /* 0 */:
                default:
                    retval.val = String(value);
                    break;
                case F_NUMERIC /* 1 */:
                case F_AUTO /* 99 */:
                    //retval.val = parseInt(pVarbind.value.toString(), 10);
                    retval.val = value;
                    if (isNaN(value)) {
                        retval.qual = 0x01;
                    } // general error
                    retval.format = F_NUMERIC;
                    break;
                case F_BOOLEAN /* 2 */: {
                    const valint = value;
                    retval.val = valint !== 0;
                    if (isNaN(valint)) {
                        retval.qual = 0x01;
                    } // general error
                    break;
                }
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify({ type: 'number', data: value });
                    break;
            }
            break;
        }

        // Since JavaScript does not offer full 64 bit integer support objects with type Counter64 cannot be supported in the same way
        // as other integer types, instead Node.js Buffer objects are used. Users are responsible for producing (i.e. for set() requests)
        // and consuming (i.e. the varbinds passed to callback functions) Buffer objects.
        case ObjectType.Counter64: {
            const buffer = pVarbind.value as Buffer;
            // convert buffer to string using bigint
            let value = BigInt(0); //bigint constant
            for (let ii = 0; ii < buffer.length; ii++) {
                value = value * BigInt(256) + BigInt(buffer[ii]);
            }
            switch (pFormat) {
                case F_TEXT /* 0 */:
                default:
                    retval.val = value.toString();
                    break;
                case F_NUMERIC /* 1 */:
                case F_AUTO /* 99 */:
                    retval.val = Number(value);
                    if (isNaN(retval.val)) {
                        retval.qual = 0x01;
                    } // general error
                    retval.format = F_NUMERIC;
                    break;
                case F_BOOLEAN /* 2 */: {
                    const valint = Number(value);
                    retval.val = valint !== 0;
                    if (isNaN(valint)) {
                        retval.qual = 0x01;
                    } // general error
                    break;
                }
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify({ type: 'number', data: buffer });
                    break;
            }
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
        // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
        case ObjectType.OctetString: {
            const value = pVarbind.value as Buffer;
            switch (pFormat) {
                case F_TEXT /* 0 */:
                case F_AUTO /* 99 */:
                default:
                    retval.val = String(value);
                    retval.format = F_TEXT;
                    break;
                case F_NUMERIC /* 1 */: {
                    const valint = parseInt(String(value), 10);
                    retval.val = valint;
                    if (isNaN(valint)) {
                        retval.qual = 0x01;
                    } // general error
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    const valint = parseInt(String(value), 10);
                    retval.val = valint !== 0;
                    if (isNaN(valint)) {
                        retval.qual = 0x01;
                    } // general error
                    break;
                }
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify(value); /* type: Buffer */
                    break;
            }
            break;
        }

        // no dcumentation for type null available
        case ObjectType.Null: {
            retval.val = null;
            retval.qual = 0x1; // general error
            retval.format = F_TEXT;
            pLog.warn(`[${pDevId}] ${pStateId} cannot convert data of type null${JSON.stringify(pVarbind)}`);
            break;
        }

        // Dotted decimal strings are used for the values of varbinds with type OID, e.g. 1.3.6.1.2.1.1.5.0.
        case ObjectType.OID: {
            const value = pVarbind.value as string;
            switch (pFormat) {
                case F_TEXT /* 0 */:
                case F_AUTO /* 99 */:
                default:
                    retval.val = String(value);
                    retval.format = F_TEXT;
                    break;
                case F_NUMERIC /* 1 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    pLog.warn(
                        `[${pDevId}] ${pStateId} cannot convert data of type oid to numeric ${JSON.stringify(pVarbind)}`,
                    );
                    break;
                case F_BOOLEAN /* 2 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    pLog.warn(
                        `[${pDevId}] ${pStateId} cannot convert data of type oid to boolean ${JSON.stringify(pVarbind)}`,
                    );
                    break;
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify(value); /* Buffer */
                    break;
            }
            break;
        }

        // Dotted quad formatted strings are used for the values of varbinds with type IpAddress, e.g. 192.168.1.1.
        case ObjectType.IpAddress: {
            const value = pVarbind.value as string;
            switch (pFormat) {
                case F_TEXT /* 0 */:
                case F_AUTO /* 99 */:
                default:
                    retval.val = String(value);
                    retval.format = F_TEXT;
                    break;
                case F_NUMERIC /* 1 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    pLog.warn(
                        `[${pDevId}] ${pStateId} cannot convert data of type ipaddress to numeric ${JSON.stringify(pVarbind)}`,
                    );
                    break;
                case F_BOOLEAN /* 2 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    pLog.warn(
                        `[${pDevId}] ${pStateId} cannot convert data of type ipaddress to boolean ${JSON.stringify(pVarbind)}`,
                    );
                    break;
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify(value); /* Buffer */
                    break;
            }
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString.
        // NOTE: currently only a heuristic implementation for floating point number is implemented for formats other than json.
        case ObjectType.Opaque: {
            const buffer = pVarbind.value as Buffer;
            if (buffer.length === 7 && buffer[0] === 159 && buffer[1] === 120 && buffer[2] === 4) {
                const value = buffer.readFloatBE(3);
                switch (pFormat) {
                    case F_TEXT /* 0 */:
                    default:
                        retval.val = value.toString();
                        break;
                    case F_NUMERIC /* 1 */:
                    case F_AUTO /* 99 */:
                        retval.val = value;
                        retval.format = F_NUMERIC;
                        break;
                    case F_BOOLEAN /* 2 */:
                        retval.val = value !== 0;
                        break;
                    case F_JSON /* 3 */:
                        retval.val = JSON.stringify(buffer); /* Buffer */
                        break;
                }
            } else {
                retval.val = null;
                retval.qual = 0x1; // general error
                retval.format = F_TEXT;
                pLog.warn(`[${pDevId}] ${pStateId} cannot convert opaque data${JSON.stringify(pVarbind)}`);
            }
            break;
        }

        case ObjectType.NoSuchObject:
        case ObjectType.NoSuchInstance:
        case ObjectType.EndOfMibView:
        default:
            retval.val = null;
            retval.qual = 0x1; // general error
            retval.format = F_TEXT;
            pLog.warn(`[${pDevId}] ${pStateId} cannot convert data${JSON.stringify(pVarbind)}`);
            break;
    }

    return retval;
}

/**
 * json2buffer - convert a json string created with format F_JSON back into a buffer
 *
 * @param pJson json string as stored in the state
 * @param pLog logger
 * @returns buffer or null if the string cannot be converted
 */
function json2buffer(pJson: string, pLog: ioBroker.Logger): Buffer | null {
    pLog.debug(`json2buffer - ${pJson}`);

    let json: { type?: string; data?: number[] } = {};
    try {
        json = JSON.parse(pJson);
    } catch (e) {
        pLog.warn(`cannot parse json data ${(e as Error).message} - ${pJson}`);
        return null;
    }

    if (json.type !== 'Buffer') {
        pLog.warn(`cannot convert json data, type must be Buffer - ${pJson}`);
        return null;
    }

    if (!json.data) {
        pLog.warn(`cannot convert json data, data element missing - ${pJson}`);
        return null;
    }

    return Buffer.from(json.data);
}

/**
 * json2boolean - convert a json string created with format F_JSON back into a boolean
 *
 * @param pJson json string as stored in the state
 * @param pLog logger
 * @returns boolean or null if the string cannot be converted
 */
function json2boolean(pJson: string, pLog: ioBroker.Logger): boolean | null {
    pLog.debug(`json2buffer - ${pJson}`);

    let json: { type?: string; data?: unknown } = {};
    try {
        json = JSON.parse(pJson);
    } catch (e) {
        pLog.warn(`cannot parse json data ${(e as Error).message} - ${pJson}`);
        return null;
    }

    if (json.type !== 'boolean') {
        pLog.warn(`cannot convert json data, type must be boolean - ${pJson}`);
        return null;
    }

    // NOTE: this rejects `{"type":"boolean","data":false}` as "data element missing". Kept as is,
    // changing it would silently alter what is written to a device.
    if (!json.data) {
        pLog.warn(`cannot convert json data, data element missing - ${pJson}`);
        return null;
    }

    return Number(json.data) !== 0;
}

/**
 * json2number - convert a json string created with format F_JSON back into a number
 *
 * @param pJson json string as stored in the state
 * @param pLog logger
 * @returns number or null if the string cannot be converted
 */
function json2number(pJson: string, pLog: ioBroker.Logger): number | null {
    pLog.debug(`json2buffer - ${pJson}`);

    let json: { type?: string; data?: unknown } = {};
    try {
        json = JSON.parse(pJson);
    } catch (e) {
        pLog.warn(`cannot parse json data ${(e as Error).message} - ${pJson}`);
        return null;
    }

    if (json.type !== 'number') {
        pLog.warn(`cannot convert json data, type must be number - ${pJson}`);
        return null;
    }

    // NOTE: this rejects `{"type":"number","data":0}` as "data element missing" - see json2boolean.
    if (!json.data) {
        pLog.warn(`cannot convert json data, data element missing - ${pJson}`);
        return null;
    }

    return Number(json.data);
}

/**
 * varbindEncode - convert native data to varbind data
 *
 * @param pState state cache entry containing the varbind template
 * @param pData data to store in varbind
 * @param pDevId id of device
 * @param pStateId id of state
 * @param pLog logger
 * @returns varbind object containing data
 */
export function varbindEncode(
    pState: StateCacheEntry,
    pData: ioBroker.StateValue,
    pDevId: string,
    pStateId: string,
    pLog: ioBroker.Logger,
): CachedVarbind {
    pLog.debug('varbindEncode - encode varbind');

    const varbind = pState.varbind as CachedVarbind;

    const retval: CachedVarbind = {
        oid: varbind.oid,
        type: varbind.type,
        value: null,
    };

    let dataType: string = typeof pData;

    switch (dataType) {
        case 'boolean':
        case 'number':
            break; /* ok, we can handle it */

        case 'string':
            if (pState.format === F_JSON) {
                dataType = 'json';
            } /* json must be handled special */
            break; /* ok, we can handle it */

        default:
            retval.value = null;
            pLog.warn(`[${pDevId}] ${pStateId} cannot encode data of type ${dataType} - ${pData}`);
            return retval;
    }

    switch (varbind.type) {
        // The JavaScript true and false keywords are used for the values of varbinds with type Boolean.
        case ObjectType.Boolean: {
            switch (dataType) {
                case 'string':
                    retval.value = String(pData) === 'true';
                    break;
                case 'number':
                    retval.value = pData !== 0;
                    break;
                case 'boolean':
                    retval.value = pData;
                    break;
                case 'json':
                    retval.value = json2boolean(pData as string, pLog);
                    break;
            }
            break;
        }

        // All integer based types are specified as expected
        case ObjectType.Integer:
        case ObjectType.Counter:
        case ObjectType.Gauge:
        case ObjectType.TimeTicks:
        case ObjectType.Integer32:
        case ObjectType.Counter32:
        case ObjectType.Gauge32:
        case ObjectType.Unsigned32: {
            switch (dataType) {
                case 'string': {
                    // NOTE: the original additionally set a `qual` attribute on the varbind if the
                    // string was not numeric. Nothing ever read it, so it has been dropped.
                    retval.value = parseInt(pData as string, 10);
                    break;
                }
                case 'number':
                    retval.value = pData;
                    break;
                case 'boolean': {
                    retval.value = pData ? 1 : 0;
                    break;
                }
                case 'json':
                    retval.value = json2number(pData as string, pLog);
                    break;
            }
            break;
        }

        // Since JavaScript does not offer full 64 bit integer support objects with type Counter64 cannot be supported in the same way
        // as other integer types, instead Node.js Buffer objects are used. Users are responsible for producing (i.e. for set() requests)
        // and consuming (i.e. the varbinds passed to callback functions) Buffer objects.
        case ObjectType.Counter64: {
            // TODO
            retval.value = null;
            pLog.warn(`[${pDevId}] ${pStateId} cannot encode data (target counter64) - ${pData}`);
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
        // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
        case ObjectType.OctetString: {
            switch (dataType) {
                case 'string':
                    retval.value = pData;
                    break;
                case 'number':
                    retval.value = String(pData);
                    break;
                case 'boolean':
                    retval.value = String(pData);
                    break;
                case 'json':
                    retval.value = json2buffer(pData as string, pLog);
                    break;
            }
            break;
        }

        // no dcumentation for type null available
        case ObjectType.Null: {
            retval.value = null;
            pLog.warn(`[${pDevId}] ${pStateId} cannot encode data (target Null) - ${pData}`);
            break;
        }

        // Dotted decimal strings are used for the values of varbinds with type OID, e.g. 1.3.6.1.2.1.1.5.0.
        case ObjectType.OID: {
            switch (dataType) {
                case 'string':
                    retval.value = pData;
                    break;
                case 'number':
                    // NOTE: the original tested for the type name 'numeric', which `typeof` never
                    // returns, so neither a warning was logged nor anything else happened here.
                    // Only the value stays null - kept silent on purpose.
                    retval.value = null;
                    break;
                case 'boolean':
                    // NOTE: the original assigned to `retval.val` (typo), which nobody reads.
                    // `retval.value` was already null, so this is the same behaviour.
                    retval.value = null;
                    pLog.warn(`[${pDevId}] ${pStateId} cannot encode BOOLEAN data (target OID) - ${pData}`);
                    break;
                case 'json':
                    retval.value = json2buffer(pData as string, pLog);
                    break;
            }
            break;
        }

        // Dotted quad formatted strings are used for the values of varbinds with type IpAddress, e.g. 192.168.1.1.
        case ObjectType.IpAddress: {
            switch (dataType) {
                case 'string':
                    retval.value = String(pData);
                    break;
                case 'number':
                    // NOTE: see the OID case - the original tested for 'numeric' and did nothing.
                    retval.value = null;
                    break;
                case 'boolean':
                    retval.value = null;
                    pLog.warn(`[${pDevId}] ${pStateId} cannot encode BOOLEAN data (target IP) - ${pData}`);
                    break;
                case 'json':
                    retval.value = json2buffer(pData as string, pLog);
                    break;
            }
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString.
        case ObjectType.Opaque: {
            switch (dataType) {
                case 'string':
                    retval.value = null;
                    pLog.warn(`[${pDevId}] ${pStateId} cannot encode STRIMG data (target opaque) - ${pData}`);
                    break;
                case 'number':
                    // NOTE: see the OID case - the original tested for 'numeric' and did nothing.
                    retval.value = null;
                    break;
                case 'boolean':
                    retval.value = null;
                    pLog.warn(`[${pDevId}] ${pStateId} cannot encode BOOLEAN data (target opaque) - ${pData}`);
                    break;
                case 'json':
                    retval.value = json2buffer(pData as string, pLog);
                    break;
            }
            break;
        }

        case ObjectType.NoSuchObject:
        case ObjectType.NoSuchInstance:
        case ObjectType.EndOfMibView:
        default: {
            retval.value = null;
            pLog.warn(`[${pDevId}] ${pStateId} cannot encode data (target default)${pData}`);
            break;
        }
    }
    return retval;
}
