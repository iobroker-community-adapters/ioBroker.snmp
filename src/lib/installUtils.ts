/**
 *
 * mcm installation support routines,
 *		copyright McM1957 2022, MIT
 *
 */

//    const res = await adapter.getObjectViewAsync('system', 'instance', {
//        startkey: 'system.adapter.snmp.',
//        endkey: 'system.adapter.snmp.香'
//    });

import type { OidConfig } from './types';

/** One row of the 'system'/'instance' object view */
type InstanceRow = ioBroker.GetObjectViewItem<ioBroker.InstanceObject>;

/** Attributes of the pre 2.0.0 configuration which are dropped during the migration */
interface LegacyConfig {
    connectTimeout?: number;
    pollInterval?: number;
    retryTimeout?: number;
}

/**
 * InstallUtils class
 *
 * Migrates (`doUpgrade`) resp. updates (`doUpdate`) the `native` section of the instance objects.
 */
export class InstallUtils {
    private readonly adapter: ioBroker.Adapter;

    /**
     * true if an instance object has been changed and the instance therefore must be restarted
     *
     * NOTE: the JavaScript original additionally declared an async method of the same name. The
     * attribute assigned in the constructor shadowed it, so `await instUtils.doRestart` always
     * awaited this boolean. The method was dead code and has been dropped.
     */
    public doRestart = false;

    public constructor(adapter: ioBroker.Adapter) {
        adapter.log.debug('mcmInstUtils/init - initializing mcmInstUtils');
        this.adapter = adapter;
    }

    private _ip2name(pIp: string): string {
        return (pIp || '').replace(this.adapter.FORBIDDEN_CHARS, '_').replace(/\./g, '_').replace(/:/g, '_');
    }

    private async _convInstance(pInstanceRow: InstanceRow): Promise<void> {
        this.adapter.log.debug(`mcmInstUtils/convInstance - process instance${pInstanceRow.id}`);

        const native = pInstanceRow.value.native as ioBroker.AdapterConfig;
        const legacy = pInstanceRow.value.native as LegacyConfig;

        const cfgVers = native.cfgVers || '0';
        const OIDs = native.OIDs;

        // migrate from config version 0
        if (Number(cfgVers) === 0 || OIDs) {
            if (OIDs && OIDs.length > 0) {
                this.adapter.log.info(`instance ${pInstanceRow.id} will be migrated`);

                native.authSets = native.authSets || [];
                native.devs = native.devs || [];
                native.oids = native.oids || [];

                const connectTimeout = Number(legacy.connectTimeout) / 1000 || 5;
                const pollInterval = Number(legacy.pollInterval) / 1000 || 30;
                const retryTimeout = Number(legacy.retryTimeout) / 1000 || 5;

                const IPs: Record<string, string> = {};
                let oidcnt = 0;

                // create OID groups based on oid ip
                for (let ii = 0; ii < OIDs.length; ii++) {
                    const oid = OIDs[ii];
                    const enabled = oid.enabled;
                    const ip = oid.ip;
                    const name = oid.name;
                    const OID = oid.OID;
                    const community = oid.publicCom;

                    // add new device
                    if (!IPs[ip]) {
                        oidcnt++;
                        const oidgrpName = `set-${oidcnt}`;
                        IPs[ip] = oidgrpName;

                        const devs = native.devs;
                        const idx = devs.length || 0;
                        devs[idx] = {
                            devAct: true,
                            devAuthId: community,
                            //devComm: community, obsolete
                            devIpAddr: ip,
                            devName: this._ip2name(ip),
                            devIp6: false,
                            devOidGroup: IPs[ip],
                            devPollIntvl: pollInterval,
                            devRetryIntvl: retryTimeout,
                            devSnmpVers: '1',
                            devTimeout: connectTimeout,
                        };
                    }

                    // add new OID
                    // NOTE: oidFormat is deliberately not set here - the original migration did not
                    // write it either. `doUpdate()` adds the default afterwards, which is what makes
                    // a migrated instance restart a second time.
                    const migratedOid: Partial<OidConfig> = {
                        oidAct: enabled,
                        oidGroup: IPs[ip],
                        oidName: name,
                        oidOid: OID,
                        oidOptional: false,
                        oidWriteable: false,
                    };

                    const oids = native.oids;
                    const idx = oids.length || 0;
                    oids[idx] = migratedOid as OidConfig;
                }

                // update config version
                native.cfgVers = '2.0';

                // remove old configuration
                delete native.OIDs;
                delete legacy.retryTimeout;
                delete legacy.connectTimeout;
                delete legacy.pollInterval;

                // write object
                await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
                this.adapter.log.info(`instance ${pInstanceRow.id} has been migrated`);
                this.doRestart = true;
            } else {
                // update config version
                native.cfgVers = '2.0';

                // remove old configuration anyway
                delete native.OIDs;
                delete legacy.retryTimeout;
                delete legacy.connectTimeout;
                delete legacy.pollInterval;

                // write object
                await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
                this.adapter.log.info(`instance ${pInstanceRow.id} provides no data to migrate`);
            }
        } else if (cfgVers === '2.0') {
            // remove old configuration anyway
            delete native.OIDs;
            delete legacy.retryTimeout;
            delete legacy.connectTimeout;
            delete legacy.pollInterval;

            // write object
            await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
            this.adapter.log.info(`instance ${pInstanceRow.id} already up to date`);
        } else {
            this.adapter.log.warn(`instance ${pInstanceRow.id} reports unknown config version '${cfgVers}'`);
        }
    }

    /**
     * doUpgrade - migrate a pre 2.0.0 configuration
     *
     * @param pInstance instance number to restrict the upgrade to, all instances if omitted
     */
    public async doUpgrade(pInstance?: number): Promise<void> {
        const tmp = typeof pInstance === 'undefined' ? '' : ` restricted to instance ${pInstance}`;
        this.adapter.log.debug(`mcmInstUtils/doUpgrade - starting upgrade process${tmp}`);

        for (const instanceRow of await this._readInstances(pInstance, 'doUpgrade')) {
            await this._convInstance(instanceRow);
        }
    }

    // _updateInstance ensures default values are set for parameters added later at cfg V2.0
    private async _updateInstance(pInstanceRow: InstanceRow): Promise<void> {
        this.adapter.log.debug(`mcmInstUtils/updateInstance - process instance${pInstanceRow.id}`);

        const native = pInstanceRow.value.native as ioBroker.AdapterConfig;
        let updated = false;
        const oids = native.oids;

        // set defaults for
        //      - oidFormat
        if (oids && oids.length > 0) {
            for (let ii = 0; ii < oids.length; ii++) {
                if (typeof oids[ii].oidFormat === 'undefined') {
                    oids[ii].oidFormat = 0;
                    updated = true;
                }
            }
        }

        if (updated) {
            // write object
            await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
            this.adapter.log.info(`instance ${pInstanceRow.id} has been updated`);
            this.doRestart = true;
        }
    }

    /**
     * doUpdate - add defaults for configuration attributes added after config version 2.0
     *
     * @param pInstance instance number to restrict the update to, all instances if omitted
     */
    public async doUpdate(pInstance?: number): Promise<void> {
        const tmp = typeof pInstance === 'undefined' ? '' : ` restricted to instance ${pInstance}`;
        this.adapter.log.debug(`mcmInstUtils/doUpdate - starting update process${tmp}`);

        for (const instanceRow of await this._readInstances(pInstance, 'doUpdate')) {
            await this._updateInstance(instanceRow);
        }
    }

    /**
     * _readInstances - read the instance objects of this adapter which live on this host
     *
     * @param pInstance instance number to restrict the result to, all instances if omitted
     * @param pCaller name of the calling routine, used for the error message only
     * @returns array of instance rows, empty if the object view cannot be read
     */
    private async _readInstances(pInstance: number | undefined, pCaller: string): Promise<InstanceRow[]> {
        let startkey = 'system.adapter.snmp.';
        let endkey = 'system.adapter.snmp.香';
        if (typeof pInstance !== 'undefined') {
            startkey = `system.adapter.snmp.${pInstance}`;
            endkey = `system.adapter.snmp.${pInstance}`;
        }

        let objView;
        try {
            objView = await this.adapter.getObjectViewAsync('system', 'instance', {
                startkey: startkey,
                endkey: endkey,
            });
        } catch (e) {
            this.adapter.log.error(`${pCaller}/getObjectViewAsync: ${(e as Error).message}`);
        }

        //skip instances of other hosts
        return (objView?.rows || []).filter(row => row.value.common.host === this.adapter.host);
    }
}
