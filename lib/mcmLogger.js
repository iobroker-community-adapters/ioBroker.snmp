/**
 *
 * mcm logger support routines, 
 *		copyright McM1957 2022, MIT
 *
 */

/**
 * mcmLogger class
 *
 * @class
 * @param   {object} adapter    ioBroker adapter object
 * @return  {object} object instance
 */
class mcmLogger{
    constructor(adapter) {
        console.log( "INFO   : initializing mcmLogger");
        this.adapter=adapter;
    }
    
    info(pMsg){
        console.log( "INFO   : "+pMsg);
        try {
            this.adapter.log.info(pMsg)
        } catch {}; 
    };
    
    warn(pMsg){
        console.log( "WARNING: "+pMsg);
        try {
            this.adapter.log.warn(pMsg)
        } catch {}; 
    };

    error(pMsg){
        console.log( "ERROR  : "+pMsg);
        try {
            this.adapter.log.error(pMsg)
        } catch {}; 
    };

    debug(pMsg){
        console.log( "DEBUG  : "+pMsg);
        try {
            this.adapter.log.debug(pMsg)
        } catch {}; 
    };

    silly(pMsg){
        console.log( "SILLY  : "+pMsg);
        try {
            this.adapter.log.silly(pMsg);
        } catch {}; 
    };
};

module.exports = mcmLogger;
