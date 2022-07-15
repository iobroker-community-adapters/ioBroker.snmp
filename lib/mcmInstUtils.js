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
 * mcmInstUtils class
 *
 * @class
 * @param   {object} adapter    ioBroker adapter object
 * @param   {object} logger     mcmLogger object
 * @return  {object} object instance
 */
class mcmInstUtils{
    constructor(adapter, logger) {
        logger.debug( "mcmInstUtils/init - initializing mcmInstUtils");
        this.adapter    = adapter;
        this.logger     = logger;
    }
    
    _ip2name(pIp) {
        return (pIp || '').replace(this.adapter.FORBIDDEN_CHARS, '_').replace(/\./g, '_').replace(/\:/g, '_');
    }
    
    async _convInstance(pInstanceRow){
        await this.logger.debug( "mcmInstUtils/convInstance - process instance" + pInstanceRow.id);

        let native = pInstanceRow.value.native;

        const cfgVers   = native.cfgVers || '0';
        const OIDs      = native.OIDs;                   

        // migrate from config version 0 
        if ( cfgVers == 0 || OIDs) {
            if (OIDs && OIDs.length > 0) {
                await this.logger.info("instance "+pInstanceRow.id+" will be migrated");
                
                native.authSets = native.authSets   || [];
                native.devs     = native.devs       || [];
                native.oids     = native.oids       || [];
                
                const connectTimeout    = native.connectTimeout/1000    ||  5;
                const pollInterval      = native.pollInterval/1000      || 30;
                const retryTimeout      = native.retryTimeout/1000      ||  5;
        
                let IPs     = {};
                let oidcnt  = 0;

                // create OID groups based on oid ip
                for (let ii=0; ii<OIDs.length; ii++) { 
                    const oid   = OIDs[ii];
                    const ip    = oid.ip;
                    const name  = oid.name;
                    const OID   = oid.OID;
                    const community = oid.publicCom;

                    // add new device
                    if ( ! IPs[ip] )
                    {
                        oidcnt++;
                        let oidgrpName='set-'+oidcnt;
                        IPs[ip] = oidgrpName;
                        
                        const devs  = native.devs;
                        const idx   = devs.length || 0;
                        devs[idx] = {};
                        devs[idx].devAct        = true;
                        devs[idx].devAuthId     = 'public';
                        devs[idx].devComm       = community;
                        devs[idx].devIpAddr     = ip;
                        devs[idx].devName       = this._ip2name(ip);
                        devs[idx].devOidGroup   = IPs[ip];
                        devs[idx].devPollIntvl  = pollInterval;
                        devs[idx].devRetryIntvl = retryTimeout;
                        devs[idx].devSnmpVers   = '1';
                        devs[idx].devTimeout    = connectTimeout;

                    }
                    
                    // add new OID
                    const oids = native.oids;
                    const idx  = oids.length || 0;
                    oids[idx] = {};
                    oids[idx].oidAct        = true;
                    oids[idx].oidGroup      = IPs[ip];
                    oids[idx].oidName       = name;
                    oids[idx].oidOid        = OID;
                    oids[idx].oidOptional   = false;
                    oids[idx].oidWriteable  = false;

                }

                // update config version
                native.cfgVers = '2.0';

                // remove old configuration
                delete native.OIDs;
                delete native.retryTimeout;
                delete native.connectTimeout;
                delete native.pollInterval;

                // write object
                await this.adapter.setForeignObjectAsync( pInstanceRow.id, pInstanceRow.value );
                await this.logger.info("instance "+pInstanceRow.id+" has been migrated");

            } else {
                // update config version
                native.cfgVers = '2.0';

                // remove old configuration anyway
                delete native.OIDs;
                delete native.retryTimeout;
                delete native.connectTimeout;
                delete native.pollInterval;

                // write object
                await this.adapter.setForeignObjectAsync( pInstanceRow.id, pInstanceRow.value );
                await this.logger.info("instance "+pInstanceRow.id+" provides no data to migrate");
            }
        } else if ( cfgVers == '2.0' ) {
            // remove old configuration anyway
            delete native.OIDs;
            delete native.retryTimeout;
            delete native.connectTimeout;
            delete native.pollInterval;

            // write object
            await this.adapter.setForeignObjectAsync( pInstanceRow.id, pInstanceRow.value );
            await this.logger.info("instance "+pInstanceRow.id+" already up to date");
        } else {
            await this.logger.warn("instance "+pInstanceRow.id+" reports unknown config version '"+cfgVers+"'");
        };
    }

    async doUpgrade(pInstance){
        const tmp=(typeof pInstance === 'undefined') ? '' : ('restricted to instance '+pInstance);
        await this.logger.debug( "mcmInstUtils/doUpgrade - starting upgrade process" + tmp);

        let startkey='system.adapter.snmp.';
        let endkey='system.adapter.snmp.\u9999';
        if (typeof pInstance !== 'undefined') {
            startkey='system.adapter.snmp.'+pInstance;
            endkey='system.adapter.snmp.'+pInstance;
        }

        let objView;
        try {
            objView = await this.adapter.getObjectViewAsync('system', 'instance', {
                                    startkey: startkey,
                                    endkey: endkey
                                });
        } catch {
            await this.logger.error(error.msg);
        }
        for (let ii=0; ii<objView.rows.length; ii++) { 
            const instanceRow = objView.rows[ii];
            await this._convInstance(instanceRow);
        }
    };
};

module.exports = mcmInstUtils;
