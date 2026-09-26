/**
 * snmp adapter - constants
 *
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
 */

/*
 * OID value formats as stored in `native.oids[].oidFormat`.
 * The numeric values are part of the stored configuration and must not be changed.
 */
export const F_TEXT = 0;
export const F_NUMERIC = 1;
export const F_BOOLEAN = 2;
export const F_JSON = 3;
export const F_AUTO = 99;

/*
 * snmp protocol versions as stored in `native.devs[].devSnmpVers`.
 * NOTE: these are NOT the version codes used by net-snmp (snmp.Version1 === 0).
 */
export const SNMP_V1 = 1;
export const SNMP_V2c = 2;
export const SNMP_V3 = 3;

/* authentication protocols as stored in `native.authSets[].authAuthProto` */
export const MD5 = 1;
export const SHA = 2;
export const SHA224 = 3;
export const SHA256 = 4;
export const SHA384 = 5;
export const SHA512 = 6;

/* encryption protocols as stored in `native.authSets[].authEncProto` */
export const DES = 1;
export const AES = 2;
export const AES256B = 3;
export const AES256R = 4;

/** default snmp port used whenever no port is appended to the configured address */
export const DEFAULT_SNMP_PORT = 161;
