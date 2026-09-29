/**
 * snmp adapter - general utility functions
 *
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 */

import { ObjectType } from 'net-snmp';

import { F_AUTO, F_BOOLEAN, F_HEX, F_JSON, F_NUMERIC, F_TEXT } from './constants';

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
        case F_HEX /* 4 */: {
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

/**
 * hexDump - the bytes of a value as a hex dump, e.g. "76 01 04 00 27 10"
 *
 *		That is the notation a MIB browser uses for binary data. The pairs are separated by blanks,
 *		so a script can cut the value apart without any further parsing.
 *
 *		A number is rendered as its own hexadecimal representation ("10000" -> "27 10"), a negative
 *		one as its 32 bit two's complement ("-128" -> "FF FF FF 80"), which is how it sits on the
 *		wire.
 *
 * @param pValue buffer or number to convert
 * @returns the bytes as upper case pairs, separated by blanks; an empty string for no bytes
 */
export function hexDump(pValue: Buffer | number): string {
    let digits: string;

    if (typeof pValue === 'number') {
        const value = Math.trunc(pValue);
        digits = (value < 0 ? value >>> 0 : value).toString(16).toUpperCase();
        if (digits.length % 2) {
            digits = `0${digits}`;
        }
    } else {
        digits = pValue.toString('hex').toUpperCase();
    }

    return digits.match(/../g)?.join(' ') ?? '';
}

/**
 * oidStateRole - the role of the ioBroker state which holds the value of one oid
 *
 *		The role tells a visualization what a state is. It depends on the type of the state and on
 *		whether it can be written, see https://www.iobroker.net/#en/documentation/dev/stateroles.md:
 *		numbers are a `value` resp. a `level`, booleans an `indicator` resp. a `switch`, a text stays
 *		`text`, and everything the device decides itself (format "automatic") is the generic `state`.
 *
 * @param pStateType type of the state as oidFormat2StateType reports it
 * @param pWriteable true if the oid is configured as writeable
 * @returns the role for `common.role`
 */
export function oidStateRole(pStateType: ioBroker.CommonType, pWriteable: boolean): string {
    switch (pStateType) {
        case 'number': {
            return pWriteable ? 'level' : 'value';
        }
        case 'boolean': {
            return pWriteable ? 'switch' : 'indicator';
        }
        case 'string': {
            return 'text';
        }
        default: {
            // "mixed" - the snmp type of the answer decides what arrives here
            return 'state';
        }
    }
}
