// Augments the globally declared ioBroker types with everything this adapter adds.
// The attributes of `AdapterConfig` must be kept in sync with `native` in io-package.json
// and with admin/jsonConfig.json.

import type { AuthConfig, DeviceConfig, OidConfig } from './types';

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** OID sets - tab "OID sets" of the config dialog */
            oids: OidConfig[];
            /** devices to poll - tab "Devices" of the config dialog */
            devs: DeviceConfig[];
            /** authorization data for snmp v3 - tab "Authorization" of the config dialog */
            authSets: AuthConfig[];

            /** maximum number of OIDs within one snmp request */
            optChunkSize: number;
            /** compatibility mode: derive the state id from the ip address instead of the device name */
            optUseName: boolean;
            /** do not close and reopen the reader session when the device reports an error */
            optNoCloseOnError: boolean;
            /** additionally create "<oid>-raw" states containing the raw varbind as json */
            optRawStates: boolean;
            /** additionally create "<oid>-type" states containing the snmp object type */
            optTypeStates: boolean;
            /**
             * interpret the OID column as a symbolic MIB name (`IF-MIB::ifDescr.1`) and derive the
             * state ids from the MIB symbol instead of from `oidName`
             */
            optUseMibNames: boolean;
            /**
             * dump every snmp request and every answer as json into the log - for a support case,
             * see `snmpTrace()` in `lib/snmpSession.ts`
             */
            optTrace: boolean;

            /** listen for snmp traps and informs - tab "Traps" of the config dialog */
            trapEnabled: boolean;
            /** udp port the traps are received on, 162 by default */
            trapPort: number;
            /** address to bind the trap socket to, empty for every interface of the host */
            trapAddress: string;
            /** receive the traps over IPv6 instead of IPv4 */
            trapIp6: boolean;
            /** community accepted for v1 and v2c traps, empty if none is */
            trapCommunity: string;
            /** id of the authorization set whose user may send v3 traps, empty if none may */
            trapAuthId: string;
            /** accept every trap without checking the community resp. the user */
            trapAcceptAll: boolean;
            /** also process traps of senders which are not configured as a device */
            trapUnknown: boolean;

            /**
             * Version of the stored configuration - written by `InstallUtils`, not part of the
             * config dialog. Missing resp. '0' triggers the migration of a pre 2.0.0 configuration.
             */
            cfgVers?: string;
            /**
             * Pre 2.0.0 OID list. Only present until `InstallUtils` has migrated the instance,
             * never written by the current code.
             */
            OIDs?: {
                enabled: boolean;
                ip: string;
                name: string;
                OID: string;
                publicCom: string;
            }[];
        }
    }
}

export {}; // needed to make this file a module
