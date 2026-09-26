/**
 * snmp adapter - general utility functions
 *
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 */

import { ObjectType } from 'net-snmp';

import { F_AUTO, F_BOOLEAN, F_JSON, F_NUMERIC, F_TEXT } from './constants';

/**
 * Convert name to id
 *
 *		This utility routine replaces all forbidden chars and the characters '-' and any whitespace
 *		with an underscore ('_').
 *
 * @param pName name of an object
 * @param pForbiddenChars the adapter's FORBIDDEN_CHARS expression
 * @returns name of the object with all forbidden chars replaced
 */
export function name2id(pName: string, pForbiddenChars: RegExp): string {
    return (pName || '').replace(pForbiddenChars, '_').replace(/[-\s]/g, '_');
}

/**
 * convert ip to ipStr
 *
 *		This utility routine replaces any dots within an ip address with an underscore ('_').
 *
 * @param ip ip string with standard formatting
 * @returns ipStr with all dots removed and useable as identifier
 */
export function ip2ipStr(ip: string): string {
    return (ip || '').replace(/\./g, '_');
}

/**
 * convert oid format to state format
 *
 * @param pOidFormat OID format code (one of the F_* constants)
 * @param pLog logger used to report unknown format codes
 * @returns state type
 */
export function oidFormat2StateType(pOidFormat: number, pLog: ioBroker.Logger): ioBroker.CommonType {
    switch (pOidFormat) {
        case F_TEXT /* 0 */: {
            return 'string';
        }
        case F_NUMERIC /* 1 */: {
            return 'number';
        }
        case F_BOOLEAN /* 2 */: {
            return 'boolean';
        }
        case F_JSON /* 3 */: {
            return 'string';
        }
        case F_AUTO /* 99 */: {
            return 'mixed';
        }
        default: {
            pLog.warn(`oidFormat2StateType - unknown code ${pOidFormat}`);
            return 'mixed';
        }
    }
}

/*
 * Textual representation of the snmp object types.
 *
 * NOTE: net-snmp uses the same numeric code for several of its type names
 * (Integer === Integer32 === 2, Counter === Counter32 === 65, Gauge === Gauge32 === Unsigned32 === 66).
 * The later entries therefore overwrite the earlier ones, which is why code 2 reads as "Integer32",
 * 65 as "Counter32" and 66 as "Unsigned32". This is the wording the adapter has always written into
 * the "<oid>-type" states, so the order of the entries below must not be changed.
 */
const OBJECT_TYPE: Record<number, string> = {};
for (const [code, text] of [
    [ObjectType.Boolean, 'Boolean'],
    [ObjectType.Integer, 'Integer'],
    [ObjectType.OctetString, 'OctetString'],
    [ObjectType.Null, 'Null'],
    [ObjectType.OID, 'OID'],
    [ObjectType.IpAddress, 'IpAddress'],
    [ObjectType.Counter, 'Counter'],
    [ObjectType.Gauge, 'Gauge'],
    [ObjectType.TimeTicks, 'TimeTicks'],
    [ObjectType.Opaque, 'Opaque'],
    [ObjectType.Integer32, 'Integer32'],
    [ObjectType.Counter32, 'Counter32'],
    [ObjectType.Gauge32, 'Gauge32'],
    [ObjectType.Unsigned32, 'Unsigned32'],
    [ObjectType.Counter64, 'Counter64'],
    [ObjectType.NoSuchObject, 'NoSuchObject'],
    [ObjectType.NoSuchInstance, 'NoSuchInstance'],
    [ObjectType.EndOfMibView, 'EndOfMibView'],
] as [number, string][]) {
    OBJECT_TYPE[code] = text;
}

/**
 * oidObjType2Text - translate oid object type into textual string
 *
 * @param pOidObjType oid object type
 * @returns textual representation of object type
 */
export function oidObjType2Text(pOidObjType: ObjectType | undefined): string {
    return OBJECT_TYPE[pOidObjType as number] || `Unknown (${pOidObjType})`;
}
