/**
 *
 * mcm installation support routines, 
 *		copyright McM1957 2022, MIT
 *
 */

const mcmLogger = require("./lib/mcmLogger");

//    const res = await adapter.getObjectViewAsync('system', 'instance', {
//        startkey: 'system.adapter.snmp.',
//        endkey: 'system.adapter.snmp.\u9999'
//    });


/**
 * mcmInstUtils class
 *
 * @class
 * @return  {object} object instance
 */
class mcmInstUtils{
    constructor() {
        this.adapter=null;
    }
    
    init(pAdapter) {
        mcmLogger.debug( "mcmInstUtils/init - initializing mcmInstUtils");
        this.adapter=pAdapter;

    }
    
    _ip2name(pIp) {
        return (pIp || '').replace(this.adapter.FORBIDDEN_CHARS, '_').replace(/\./g, '_').replace(/\:/g, '_');
    }
    
    async _convInstance(pInstanceRow){
        mcmLogger.debug( "mcmInstUtils/convInstance - process instance" + pInstanceRow.id);

        let native = pInstanceRow.value.native;

        const cfgVers = native.cfgVers || '0';

        // migrate from config version 0 
        if ( cfgVers == 0 ) {
            const OIDs  = native.OIDs;                   
            if (OIDs && OIDs.length > 0) {
                mcmLogger.info("instance "+pInstanceRow.id+" will be migrated");
                
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

                    // update config version
                    native.cfgVers = '2.0';

                    // remove old configuration
                    native.OIDs             = null;
                    native.retryTimeout     = null;
                    native.connectTimeout   = null;
                    native.pollInterval     = null;
                }

                // write object
                await this.adapter.setForeignObjectAsync( pInstanceRow.id, pInstanceRow.value );
                mcmLogger.info("instance "+pInstanceRow.id+" has been migrated");

            } else {
                mcmLogger.info("instance "+pInstanceRow.id+" provides no data to migrate");
            }
        } else if ( cfgVers == '2.0' ) {
            mcmLogger.info("instance "+pInstanceRow.id+" already up to date");
        } else {
            mcmLogger.warn("instance "+pInstanceRow.id+" reports unknown config version '"+cfgVers+"'");
        };
    }

    async doUpgrade(){
        mcmLogger.debug( "mcmInstUtils/doUpgrade - starting upgrade process");

        const objView = await this.adapter.getObjectViewAsync('system', 'instance', {
                                    startkey: 'system.adapter.snmp.',
                                    endkey: 'system.adapter.snmp.\u9999'
                                });

        for (let ii=0; ii<objView.rows.length; ii++) { 
            const instanceRow = objView.rows[ii];
            await this._convInstance(instanceRow);
        }
    };
};

module.exports = new mcmInstUtils;
