/**
 *
 * mcm installation support routines,
 *		copyright McM1957 2022, MIT
 *
 */

//    const res = await adapter.getObjectViewAsync('system', 'instance', {
//        startkey: 'system.adapter.snmp.',
//        endkey: 'system.adapter.snmp.\u9999'
//    });


/**
 * InstallUtils class
 *
 * @class
 * @param   {object} adapter    ioBroker adapter object
 * @return  {object} object instance
 */
class InstallUtils {

    constructor(adapter) {
        adapter.log.debug('mcmInstUtils/init - initializing mcmInstUtils');
        this.adapter = adapter;
        this.doRestart = false;
    }

    _ip2name(pIp) {
        return (pIp || '').replace(this.adapter.FORBIDDEN_CHARS, '_').replace(/\./g, '_').replace(/:/g, '_');
    }

    async _convInstance(pInstanceRow) {
        this.adapter.log.debug('mcmInstUtils/convInstance - process instance' + pInstanceRow.id);

        const native = pInstanceRow.value.native;

        const cfgVers = native.cfgVers || '0';
        const OIDs = native.OIDs;

        // migrate from config version 0
        if (cfgVers == 0 || OIDs) {
            if (OIDs && OIDs.length > 0) {
                this.adapter.log.info('instance ' + pInstanceRow.id + ' will be migrated');

                native.authSets = native.authSets || [];
                native.devs = native.devs || [];
                native.oids = native.oids || [];

                const connectTimeout = native.connectTimeout / 1000 || 5;
                const pollInterval = native.pollInterval / 1000 || 30;
                const retryTimeout = native.retryTimeout / 1000 || 5;

                const IPs = {};
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
                        const oidgrpName = 'set-' + oidcnt;
                        IPs[ip] = oidgrpName;

                        const devs = native.devs;
                        const idx = devs.length || 0;
                        devs[idx] = {};
                        devs[idx].devAct = true;
                        devs[idx].devAuthId = community;
                        //devs[idx].devComm = community; obsolete
                        devs[idx].devIpAddr = ip;
                        devs[idx].devName = this._ip2name(ip);
                        devs[idx].devOidGroup = IPs[ip];
                        devs[idx].devPollIntvl = pollInterval;
                        devs[idx].devRetryIntvl = retryTimeout;
                        devs[idx].devSnmpVers = '1';
                        devs[idx].devTimeout = connectTimeout;

                    }

                    // add new OID
                    const oids = native.oids;
                    const idx = oids.length || 0;
                    oids[idx] = {};
                    oids[idx].oidAct = enabled;
                    oids[idx].oidGroup = IPs[ip];
                    oids[idx].oidName = name;
                    oids[idx].oidOid = OID;
                    oids[idx].oidOptional = false;
                    oids[idx].oidWriteable = false;

                }

                // update config version
                native.cfgVers = '2.0';

                // remove old configuration
                delete native.OIDs;
                delete native.retryTimeout;
                delete native.connectTimeout;
                delete native.pollInterval;

                // write object
                await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
                this.adapter.log.info('instance ' + pInstanceRow.id + ' has been migrated');
                this.doRestart = true;

            } else {
                // update config version
                native.cfgVers = '2.0';

                // remove old configuration anyway
                delete native.OIDs;
                delete native.retryTimeout;
                delete native.connectTimeout;
                delete native.pollInterval;

                // write object
                await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
                this.adapter.log.info('instance ' + pInstanceRow.id + ' provides no data to migrate');
            }
        } else if (cfgVers == '2.0') {
            // remove old configuration anyway
            delete native.OIDs;
            delete native.retryTimeout;
            delete native.connectTimeout;
            delete native.pollInterval;

            // write object
            await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
            this.adapter.log.info('instance ' + pInstanceRow.id + ' already up to date');
        } else {
            this.adapter.log.warn('instance ' + pInstanceRow.id + " reports unknown config version '" + cfgVers + "'");
        }
    }

    async doUpgrade(pInstance) {
        const tmp = (typeof pInstance === 'undefined') ? '' : (' restricted to instance ' + pInstance);
        this.adapter.log.debug('mcmInstUtils/doUpgrade - starting upgrade process' + tmp);

        let startkey = 'system.adapter.snmp.';
        let endkey = 'system.adapter.snmp.\u9999';
        if (typeof pInstance !== 'undefined') {
            startkey = 'system.adapter.snmp.' + pInstance;
            endkey = 'system.adapter.snmp.' + pInstance;
        }

        let objView;
        try {
            objView = await this.adapter.getObjectViewAsync('system', 'instance', {
                startkey: startkey,
                endkey: endkey
            });
        } catch (e) {
            this.adapter.log.error('doUpgrade/getObjectViewAsync: ' + e.message);
        }
        if (objView && objView.rows) {
            for (let ii = 0; ii < objView.rows.length; ii++) {
                const instanceRow = objView.rows[ii];
                if (instanceRow.value.common.host !== this.adapter.host) {
                    continue; //skip instances of other hosts
                }
                await this._convInstance(instanceRow);
            }
        }
    }

    // _updateInstance ensures default values are set for parameters added later at cfg V2.0
    async _updateInstance(pInstanceRow) {
        this.adapter.log.debug('mcmInstUtils/updateInstance - process instance' + pInstanceRow.id);

        const native = pInstanceRow.value.native;
        let updated = false;
        const oids = native.oids;

        // set defaults for
        //      - oidFormat
        if (oids && oids.length > 0) {
            for (let ii = 0; ii < oids.length; ii++) {
                if ( typeof(oids[ii].oidFormat) === 'undefined' ) {
                    oids[ii].oidFormat = 0;
                    updated = true;
                }
            }
        }

        if (updated) {
            // write object
            await this.adapter.setForeignObjectAsync(pInstanceRow.id, pInstanceRow.value);
            this.adapter.log.info('instance ' + pInstanceRow.id + ' has been updated');
            this.doRestart = true;
        }
    }

    async doUpdate(pInstance) {
        const tmp = (typeof pInstance === 'undefined') ? '' : (' restricted to instance ' + pInstance);
        this.adapter.log.debug('mcmInstUtils/doUpdate - starting update process' + tmp);

        let startkey = 'system.adapter.snmp.';
        let endkey = 'system.adapter.snmp.\u9999';
        if (typeof pInstance !== 'undefined') {
            startkey = 'system.adapter.snmp.' + pInstance;
            endkey = 'system.adapter.snmp.' + pInstance;
        }

        let objView;
        try {
            objView = await this.adapter.getObjectViewAsync('system', 'instance', {
                startkey: startkey,
                endkey: endkey
            });
        } catch (e) {
            this.adapter.log.error('doUpdate/getObjectViewAsync: ' + e.message);
        }
        if (objView && objView.rows) {
            for (let ii = 0; ii < objView.rows.length; ii++) {
                const instanceRow = objView.rows[ii];
                if (instanceRow.value.common.host !== this.adapter.host) {
                    continue; //skip instances of other hosts
                }
                await this._updateInstance(instanceRow);
            }
        }
    }

    async doRestart() {
        return this.doRestart;
    }

}

module.exports = InstallUtils;
