/**
 *
 * snmp adapter,
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022, MIT
 *
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

/*
 * Some general REMINDERS for further development
 *
 * - Ensure that every timer value is less than 0x7fffffff - otherwise the time will fire immidiatly
 *
 */

/*
 * description if major internal objects
 *
 *	CTXs		object (array) of CTX objectes
 *
 *  CTX         object for one signle device
 *    containing
 *      name       string   name of the device
 *      ipAddr     string   ip address (without port number)
 *      ipPort     number   ip port number
 *      id         string   id of device, dereived from ip address or from name
 *      isIPv6     bool     true if IPv6 to be used
 *      timeout    number   snmp connect timeout (ms)
 *      retryIntvl number   snmp retry intervall (ms)
 *      pollIntvl  number   snmp poll intervall (ms)
 *      snmpVers   number   snmp version
 *      community  string   snmp comunity (v1, v2c)
 *      chunks     array    array of oid data consiting of
 *      {
 *          OIDs       array of objects
 *                          oid config object (contains i.e. flags)
 *          oids       array of strings
 *                          oids to be read
 *          ids        array of strings
 *                          ids for oids to be read
 *      }
 *      pollTimer  object   timer object for poll timer
 *      retryTimer object   timer object for retry timer
 *      session    object   snmp session object
 *      inactive   bool     flag indicating conection status of device
 */

/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';

const F_TEXT = 0;
const F_NUMERIC = 1;
const F_BOOLEAN = 2;
const F_JSON = 3;

const SNMP_V1 = 1;
const SNMP_V2c = 2;
const SNMP_V3 = 3;

const MD5 = 1;
const SHA = 2;

const DES = 1;
const AES = 2;
const AES256B = 3;
const AES256R = 4;

/*
 * based on template created with @iobroker/create-adapter v2.1.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const { EXIT_CODES } = require('@iobroker/js-controller-common');
const InstallUtils = require('./lib/installUtils');

// Load modules required by adapter
const snmp = require('net-snmp');
const net = require('net');

// init installation marker
let doInstall = false;
let didInstall = false;

// #################### global variables ####################
let adapter;    // adapter instance - @type {ioBroker.Adapter}

const CTXs = [];		    // see description at header of file
const STATEs = [];          // states cache
let g_isConnected = false; 	// local copy of info.connection state
let g_connUpdateTimer = null;
let g_chunkSize = 3;         // maximum number of OIDs per request

/**
 * Start the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    adapter = utils.adapter(Object.assign({}, options, {
        name: 'snmp',

        // ready callback is called when databases are connected and adapter received configuration.
        ready: onReady, // Main method defined below for readability

        // unload callback is called when adapter shuts down - callback has to be called under any circumstances!
        unload: onUnload,

        // If you need to react to object changes, uncomment the following method.
        // You also need to subscribe to the objects with `adapter.subscribeObjects`, similar to `adapter.subscribeStates`.
        // objectChange: (id, obj) => {
        // 	if (obj) {
        // 		// The object was changed
        // 		adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        // 	} else {
        // 		// The object was deleted
        // 		adapter.log.info(`object ${id} deleted`);
        // 	}
        // },

        // stateChange is called if a subscribed state changes
        // stateChange: (id, state) => {
        //	if (state) {
        //		// The state was changed
        //		adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        //	} else {
        //		// The state was deleted
        //		adapter.log.info(`state ${id} deleted`);
        //	}
        //},

        // If you need to accept messages in your adapter, uncomment the following block.
        // /**
        //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
        //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
        //  */
        // message: (obj) => {
        // 	if (typeof obj === 'object' && obj.message) {
        // 		if (obj.command === 'send') {
        // 			// e.g. send email or pushover or whatever
        // 			adapter.log.info('send command');

        // 			// Send response in callback if required
        // 			if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        // 		}
        // 	}
        // },
    }));

    return adapter;
}

/* *** end of initialization section *** */



// #################### general utility functions ####################

/**
 * Convert name to id
 *
 *		This utility routine replaces all forbidden chars and the characters '-' and any whitespace
 *		with an underscore ('_').
 *
 * @param   {string}    pName 	name of an object
 * @return  {string} 		    name of the object with all forbidden chars replaced
 *
 */
function name2id(pName) {
    return (pName || '').replace(adapter.FORBIDDEN_CHARS, '_').replace(/[-\s]/g, '_');
}

/**
 * convert ip to ipStr
 *
 *		This utility routine replaces any dots within an ip address with an underscore ('_').
 *
 * @param {string} 	ip 	ip string with standard foematting
 * @return {string} 	ipStr with all dots removed and useable as identifier
 *
 */
function ip2ipStr(ip) {
    return (ip || '').replace(/\./g, '_');
}

/**
 * convert oid format to state format
 *
 * @param {number} 	    pOidFormat 	OID format code
 * @return {string} 	            state type
 *
 */
function oidFormat2StateType(pOidFormat){
    switch (pOidFormat){
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
        default:{
            adapter.log.warn('oidFormat2StateType - unknown code ' + pOidFormat );
            return 'string';
        }
    }
}

// #################### object initialization functions ####################

/**
 * initObject - create or reconfigure single object
 *
 *		creates object if it does not exist
 *		overrides object data otherwise
 *		waits for action to complete using await
 *
 * @param {obj}     pObj    objectstructure
 * @return
 *
 */
async function initObject(pObj) {
    adapter.log.debug('initobject ' + pObj._id);

    if (typeof(STATEs[pObj._id]) === 'undefined') {
        try {
            adapter.log.debug('creating obj "' + pObj._id + '" with state-type '+pObj.common.type);
            await adapter.setObjectNotExistsAsync(pObj._id, pObj);
        } catch (e) {
            adapter.log.error('error initializing obj "' + pObj._id + '" ' + e.message);
        }
    }

    if (pObj.type === 'state') {
        if (typeof (STATEs[pObj._id]) === 'undefined' ) {
            adapter.log.debug('extending obj "' + pObj._id + '" with '+ JSON.stringify(pObj));
            await adapter.extendObjectAsync(pObj._id, pObj);
            STATEs[ pObj._id ] = {
                value: null,
                oidType: null,
                type: pObj.common.type
            };
        }

        if ( STATEs[pObj._id].type !== pObj.common.type ) {
            try {
                adapter.log.info('reinitializing obj "' + pObj._id + '" state-type change '+STATEs[pObj._id].type+' -> '+pObj.common.type);
                await adapter.extendObjectAsync(pObj._id, {common: { type: pObj.common.type }});
                STATEs[pObj._id].type = pObj.common.type;
            } catch (e) {
                adapter.log.error('error reinitializing obj "' + pObj._id + '" ' + e.message);
            }
        }
    }
}

/**
 * initDeviceObjects - initializes all objects related to a device
 *
 * @param   {string}    pId     id of device
 * @param   {string}    pIp     ip of device
 * @return
 *
 */
async function initDeviceObjects(pId, pIp) {
    adapter.log.debug('initdeviceObjects (' + pId + '/' + pIp + ')');

    try {
        // create <ip> device object
        await initObject({
            _id: pId,
            type: 'device',
            common: {
                name: pIp
            },
            native: {
            }
        }
        );

        // create <ip>.online state object
        await initObject({
            _id: pId + '.online',
            type: 'state',
            common: {
                name: pIp + ' online',
                write: false,
                read: true,
                type: 'boolean',
                role: 'indicator.reachable'
            },
            native: {
            }
        }
        );
    } catch (e) {
        adapter.log.error('error creating objects for ip "' + pIp + '" (' + pId + '), ' + e.message);
    }
}

/**
 * initOidObjects - initializes objects for one OID
 *
 * @param   {string}    id  if of object
 * @return
 *
 * ASSERTION: root device object is already created
 *
 */
async function initOidObjects(pId, pOid, pOID) {
    adapter.log.debug('initOidObjects (' + pId + ')');

    try {
        // create OID folder objects
        const idArr = pId.split('.');
        let partlyId = idArr[0];
        for (let ii = 1; ii < idArr.length - 1; ii++) {
            const el = idArr[ii];
            partlyId += '.' + el;
            await initObject({
                _id: partlyId,
                type: 'folder',
                common: {
                    name: ''
                },
                native: {
                }
            });
        }

        // create OID state objects
        // id ........ normal data returned (string, json, number, boolean)
        // id.type ... iod type code
        // id.raw .... json stringified origianl data received (optional)
        await initObject({
            _id: pId,
            type: 'state',
            common: {
                name: pId,
                write: !!pOID.oidWriteable, //## TODO
                read: true,
                type: oidFormat2StateType(pOID.oidFormat),
                role: 'value'
            },
            native: {
            }
        });

        await initObject({
            _id: pId+'-type',
            type: 'state',
            common: {
                name: pId+'-type',
                write: false,
                read: true,
                type: 'string',
                role: 'type.encoding'
            },
            native: {
            }
        });

        // create OID state.raw objects
        if (adapter.config.optRawStates) {
            await initObject({
                _id: pId+'-raw',
                type: 'state',
                common: {
                    name: pId+'-raw',
                    write: false,
                    read: true,
                    type: 'string',
                    role: 'json'
                },
                native: {
                }
            });
        }
    } catch (e) {
        adapter.log.error('error processing oid id "' + pId + '" (oid "' + pOid + ') - ' + e.message);
    }
}

/**
 * initAllObjects - initialize all objects
 *
 * @param
 * @return
 *
 */
async function initAllObjects() {
    adapter.log.debug('initAllObjects - initializing objects');

    for (let ii = 0; ii < CTXs.length; ii++) {
        await initDeviceObjects(CTXs[ii].id, CTXs[ii].ipAddr);

        for (let cc = 0; cc < CTXs[ii].chunks.length; cc++) {
            for (let jj = 0; jj < CTXs[ii].chunks[cc].ids.length; jj++) {
                await initOidObjects(CTXs[ii].chunks[cc].ids[jj], CTXs[ii].chunks[cc].oids[jj], CTXs[ii].chunks[cc].OIDs[jj]);
            }
        }
    }
}



// #################### snmp session handling functions ####################


/**
 * onSessionClose - callback called whenever a session is closed
 *
 * @param {CTX object}  pCTX    CTX object
 * @return
 *
 */
async function onSessionClose(pCTX) {
    adapter.log.debug('onSessionClose - device ' + pCTX.name + ' (' + pCTX.ipAddr + ')');

    clearInterval(pCTX.pollTimer);
    pCTX.pollTimer = null;
    pCTX.session = null;

    pCTX.retryTimer = setTimeout((pCTX) => {
        pCTX.retryTimer = null;
        createSession(pCTX);
    }, pCTX.retryIntvl, pCTX);
}

/**
 * onSessionError - callback called whenever a session encounters an error
 *
 * @param {CTX object} 	pCTX    CTX object
 * @param {object}      pErr    error object
 * @return
 *
 */
async function onSessionError(pCTX, pErr) {
    adapter.log.debug('onSessionError - device ' + pCTX.name + ' (' + pCTX.ipAddr + ') - ' + pErr.toString);

    // ### to be implemented ###
}

/**
/**
 * createSession - initializes a snmp session to one device and starts reader thread
 *
 * @param   {CTX object}    pCTX    CTX object
 * @return
 *
var options = {
    port: 161,
    retries: 1,
    timeout: 5000,
    backoff: 1.0,
    transport: "udp4",
    trapPort: 162,
    version: snmp.Version1,
    backwardsGetNexts: true,
    idBitsSize: 32
}; */
async function createSession(pCTX) {
    adapter.log.debug('createSession - device ' + pCTX.name + ' (' + pCTX.ipAddr + ')');

    // (re)set device online status
    adapter.setState(pCTX.id + '.online', false, true);

    // close old session if one exists
    if (pCTX.retryTimer) {
        clearTimeout(pCTX.retryTimer);
        pCTX.retryTimer = null;
    }

    if (pCTX.pollTimer) {
        clearInterval(pCTX.pollTimer);
        pCTX.pollTimer = null;
    }

    if (pCTX.session) {
        try {
            pCTX.session.on('error', null); // avoid nesting callbacks
            pCTX.session.on('close', null); // avoid nesting callbacks
            pCTX.session.close();
        } catch (e) {
            adapter.log.warn('cannot close session for device "' + pCTX.name + '" (' + pCTX.ip + '), ' + e);
        }
        pCTX.session = null;
    }

    // create snmp session for device
    if (pCTX.snmpVers == SNMP_V1 ||
        pCTX.snmpVers == SNMP_V2c) {

        const snmpTransport = pCTX.isIPv6 ? 'udp6' : 'udp4';
        const snmpVersion = (pCTX.snmpVers == SNMP_V1) ? snmp.Version1 : snmp.Version2c;

        pCTX.session = snmp.createSession(pCTX.ipAddr, pCTX.authId, {
            port: pCTX.ipPort,   // default:161
            retries: 1,
            timeout: pCTX.timeout,
            backoff: 1.0,
            transport: snmpTransport,
            //trapPort: 162,
            version: snmpVersion,
            backwardsGetNexts: true,
            idBitsSize: 32
        });

    } else if (pCTX.snmpVers == SNMP_V3) {

        let snmpSecurityLevel = 0;
        if ( pCTX.authSecLvl == 1 ) {
            snmpSecurityLevel = snmp.SecurityLevel.noAuthNoPriv; // no message authentication or encryption
        } else if ( pCTX.authSecLvl == 2 ) {
            snmpSecurityLevel = snmp.SecurityLevel.authNoPriv;  // message authentication and no encryption
        } else if ( pCTX.authSecLvl == 3 ) {
            snmpSecurityLevel = snmp.SecurityLevel.authPriv;    //for message authentication and encryption
        }

        let snmpAuthProtocol = 0;
        if ( pCTX.authAuthProto == MD5 ) {
            snmpAuthProtocol = snmp.AuthProtocols.md5;  // MD5 message authentication
        } else if ( pCTX.authAuthProto == SHA )  {
            snmpAuthProtocol = snmp.AuthProtocols.sha;   // SHA message authentication
        }

        let snmpPrivProtocol = 0;
        if ( pCTX.authEncProto == DES ) {
            snmpPrivProtocol = snmp.PrivProtocols.des; // DES encryption
        } else if ( pCTX.authEncProto == AES ) {
            snmpPrivProtocol = snmp.PrivProtocols.aes; // AES encryption
        } else if ( pCTX.authEncProto == AES256B ) {
            snmpPrivProtocol = snmp.PrivProtocols.SecLvlAES256B; // AES encryption
        } else if ( pCTX.authEncProto == AES256R ) {
            snmpPrivProtocol = snmp.PrivProtocols.AES256R; // AES encryption
        }

        const snmpUser = {
            name: pCTX.authUser,
            level: snmpSecurityLevel,
            authProtocol: snmpAuthProtocol,
            authKey: pCTX.authAuthKey,
            privProtocol: snmpPrivProtocol,
            privKey: pCTX.authEncKey
        };

        const snmpTransport = pCTX.isIPv6 ? 'udp6' : 'udp4';
        const snmpVersion = snmp.Version3;
        // ??? engineID: "8000B98380XXXXXXXXXXXXXXXXXXXXXXXX", // where the X's are random hex digits

        pCTX.session = snmp.createV3Session(pCTX.ipAddr, snmpUser, {
            port: pCTX.ipPort,   // default:161
            retries: 1,
            timeout: pCTX.timeout,
            backoff: 1.0,
            transport: snmpTransport,
            //trapPort: 162,
            version: snmpVersion,
            backwardsGetNexts: true,
            idBitsSize: 32,
            context: ''
        });
    } else {
        adapter.log.error('unsupported snmp version code (' + pCTX.snmpVers + ') for device "' + pCTX.name + '" (' + pCTX.ip + ')');
    }

    if (pCTX.session) {
        pCTX.session.on('close', () => { onSessionClose(pCTX); });
        pCTX.session.on('error', (err) => { onSessionError(pCTX, err); });
        pCTX.pollTimer = setInterval(readOids, pCTX.pollIntvl, pCTX);

        // read one time immediately
        readOids(pCTX);
    }

    adapter.log.debug('session for device "' + pCTX.name + '" (' + pCTX.ipAddr + ')' + (pCTX.session ? '' : ' NOT') + ' created');

}

/**
 * processVarbind - process single varbind
 *
 * @param {pVarbind} snmp varbind object
 * @return string
 *
 */
async function processVarbind(pCTX, pChunkIdx, pId, pIdx, pVarbind) {
    adapter.log.debug('processVarbind - [' + pId + '] ' + pCTX.chunks[pChunkIdx].ids[pIdx]);

    let val;
    let valTypeStr;
    const OID = pCTX.chunks[pChunkIdx].OIDs[pIdx];
    const oidFormat = OID.oidFormat;

    switch (pVarbind.type){
        case snmp.ObjectType.Boolean:{
            valTypeStr = 'Boolean';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = JSON.parse(pVarbind.value)?1:0;
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = JSON.parse(pVarbind.value);
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Integer:{
            valTypeStr = 'Integer';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.OctetString:{
            valTypeStr = 'OctetString';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Null:{
            valTypeStr = 'Null';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.OID:{
            valTypeStr = 'OID';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.IpAddress:{
            valTypeStr = 'IpAddress';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Counter:{
            valTypeStr = 'Counter';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Gauge:{
            valTypeStr = 'Gauge';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.TimeTicks:{
            valTypeStr = 'TimeTicks';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Opaque:{
            valTypeStr = 'Opaque';
            if ( pVarbind.value.length === 7 &&
                pVarbind.value[0] === 159 &&
                pVarbind.value[1] === 120 &&
                pVarbind.value[2] === 4 ) {
                const value = pVarbind.value.readFloatBE(3);
                switch (oidFormat) {
                    case F_TEXT /* 0 */: {
                        val = value.toString();
                        break;
                    }
                    case F_NUMERIC /* 1 */: {
                        val = value;
                        break;
                    }
                    case F_BOOLEAN /* 2 */: {
                        val = !!value;
                        break;
                    }
                    case F_JSON /* 3 */: {
                        val = JSON.stringify(pVarbind.value);
                        break;
                    }
                    default:{
                        val = value.toString();
                        break;
                    }
                }
            }
            else {
                val = null;
                adapter.log.error('[' + pId + '] ' + pCTX.chunks[pChunkIdx].ids[pIdx] + ' cannot convert opaque data ' + JSON.stringify(pVarbind));
            }
            break;
        }
        case snmp.ObjectType.Integer32:{
            valTypeStr = 'Integer32';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Counter32:{
            valTypeStr = 'Counter32';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Gauge32:{
            valTypeStr = 'Gauge32';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Unsigned32:{
            valTypeStr = 'Unsigned32';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.Counter64:{
            valTypeStr = 'Counter64';
            // convert buffer to string using bigin
            let value = BigInt(0); //bigint constant
            for (let ii= 0; ii<pVarbind.value.length; ii++){
                value=value*BigInt(256) + BigInt(pVarbind.value[ii]);
            }
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = value;
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = value!=0;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = value.toString();
                    break;
                }
            }
            break;
        }
        case snmp.ObjectType.NoSuchObject:{
            valTypeStr = 'NoSuchObject';
            val = null;
            break;
        }
        case snmp.ObjectType.NoSuchInstance:{
            valTypeStr = 'NoSuchInstance';
            val = null;
            break;
        }
        case snmp.ObjectType.EndOfMibView:{
            valTypeStr = 'EndOfMibView';
            val = null;
            break;
        }
        default:{
            valTypeStr = 'Unknown';
            switch (oidFormat) {
                case F_TEXT /* 0 */: {
                    val = pVarbind.value.toString();
                    break;
                }
                case F_NUMERIC /* 1 */: {
                    val = parseInt(pVarbind.value.toString, 10);
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    val = parseInt(pVarbind.value.toString, 10) == 1;
                    break;
                }
                case F_JSON /* 3 */: {
                    val = JSON.stringify(pVarbind.value);
                    break;
                }
                default:{
                    val = pVarbind.value.toString();
                    break;
                }
            }
            break;
        }
    }
    adapter.log.debug('[' + pId + '] ' + pCTX.chunks[pChunkIdx].ids[pIdx] + '(' + valTypeStr + ')' + JSON.stringify(pVarbind));
    adapter.log.debug('[' + pId + '] update ' + pCTX.chunks[pChunkIdx].ids[pIdx] + ': ' + val);

    // data OK
    await initObject({
        _id: pCTX.chunks[pChunkIdx].ids[pIdx],
        type: 'state',
        common: {
            name: pId,
            write: !!OID.oidWriteable, //## TODO
            read: true,
            type: oidFormat2StateType(pCTX.chunks[pChunkIdx].OIDs[pIdx].oidFormat),
            role: 'value'
        },
        native: {
        }
    });
    adapter.setState(pCTX.chunks[pChunkIdx].ids[pIdx], val, true);
    adapter.setState(pCTX.chunks[pChunkIdx].ids[pIdx]+'-type', pVarbind.type + ': '+valTypeStr, true);
    if (adapter.config.optRawStates){
        adapter.setState(pCTX.chunks[pChunkIdx].ids[pIdx]+'-raw', JSON.stringify(pVarbind), true);
    }
    return;
}

/**
 * readChunkOids - read all oids within one chunk from a specific target device
 *
 * @param {pCtx} specific context
 * @param {pIdx} chunk index
 * @return
 *
 */

async function readChunkOids(pCTX, pIdx) {
    adapter.log.debug('readChunkOIDs - device "' + pCTX.name + '" (' + pCTX.ipAddr + '), chunk idx ' + pIdx);

    return new Promise((resolve,_reject)=>{
        const session = pCTX.session;
        const id = pCTX.id;
        const oids = pCTX.chunks[pIdx].oids;
        // const ids = pCTX.chunks[pIdx].ids;

        if (! session) {
            // issue #151 - the session object might get deleted during prosessing of get loop
            adapter.log.debug( 'session vanished, skipping get oparation');
            resolve();
        } else {
            session.get(oids, (err, varbinds) => {
                adapter.log.debug('[' + id + '] session.get completed for chunk index ' + pIdx );
                if (err) {
                    // error occured
                    adapter.log.debug('[' + id + '] session.get: ' + err.toString());
                    if (err.toString() === 'RequestTimedOutError: Request timed out') {
                        // timeout error
                        for (let ii = 0; ii < pCTX.chunks[pIdx].ids.length; ii++) {
                            adapter.setState(pCTX.chunks[pIdx].ids[ii], {q:0x02} ); // connection problem
                            adapter.setState(pCTX.chunks[pIdx].ids[ii]+'-type', {q:0x02} ); // connection problem
                        }
                        if (!pCTX.inactive || !pCTX.initialized) {
                            adapter.log.info('[' + id + '] device disconnected - request timout');
                            pCTX.inactive = true;
                            setImmediate(handleConnectionInfo);
                        }
                    } else {
                        // other error
                        for (let ii = 0; ii < pCTX.chunks[pIdx].ids.length; ii++) {
                            adapter.setState(pCTX.chunks[pIdx].ids[ii], {val: null, ack: true, q:0x44} ); // device reports error
                            adapter.setState(pCTX.chunks[pIdx].ids[ii]+'-type', {val: null, ack: true, q:0x44} ); // device reports error
                        }
                        if (!pCTX.inactive || !pCTX.initialized) {
                            adapter.log.error('[' + id + '] session.get: ' + err.toString());
                            adapter.log.info('[' + id + '] device disconnected');
                            pCTX.inactive = true;
                            setImmediate(handleConnectionInfo);
                        }
                    }
                    adapter.setState(id + '.online', false, true);
                } else {
                    // success
                    if (pCTX.inactive) {
                        adapter.log.info('[' + id + '] device (re)connected');
                        pCTX.inactive = false;
                        setImmediate(handleConnectionInfo);
                    }
                    adapter.setState(id + '.online', true, true);

                    // process returned values
                    for (let ii = 0; ii < varbinds.length; ii++) {
                        if (snmp.isVarbindError(varbinds[ii])) {
                            if ( ! pCTX.chunks[pIdx].OIDs[ii].oidOptional ||
                                ! snmp.varbindError(varbinds[ii]).startsWith('NoSuchInstance:') ) {
                                adapter.log.error('[' + id + '] session.get: ' + snmp.varbindError(varbinds[ii]));
                            }
                            adapter.setState(pCTX.chunks[pIdx].ids[ii], { val: null, ack: true, q: 0x84}); // sensor reports error
                            adapter.setState(pCTX.chunks[pIdx].ids[ii]+'-type', { val: null, ack: true, q: 0x84}); // sensor reports error
                        } else {
                            //adapter.log.debug('[' + id + '] update ' + pCTX.ids[ii] + ': ' + varbinds[ii].value.toString());
                            //adapter.setState(pCTX.ids[ii], varbinds[ii].value.toString(), true); // data OK
                            processVarbind(pCTX, pIdx, id, ii, varbinds[ii]);
                        }
                    }
                }

                if (!pCTX.initialized) {
                    pCTX.initialized = true;
                    setImmediate(handleConnectionInfo);
                }
                resolve();
            });
        }
    });
}

/**
 * readOids - read all oids from a specific target device
 *
 * @param {IP} IP object
 * @return
 *
 */
async function readOids(pCTX) {
    adapter.log.debug('readOIDs - device "' + pCTX.name + '" (' + pCTX.ipAddr + ')');

    //const session = pCTX.session;
    const id = pCTX.id;

    for (let cc = 0; cc < pCTX.chunks.length; cc++) {
        adapter.log.debug('[' + id + '] processing oid chunk index ' + cc );
        await readChunkOids( pCTX, cc);
        adapter.log.debug('[' + id + '] processing oid chunk index ' + cc + ' completed' );
    }
}

// #################### general housekeeping functions ####################

function handleConnectionInfo() {
    adapter.log.debug('handleConnectionInfo');

    let haveConnection = false;
    for (let ii = 0; ii < CTXs.length; ii++) {
        if (!CTXs[ii].inactive) {
            haveConnection = true;
        }
    }

    if (g_isConnected !== haveConnection) {
        if (haveConnection) {
            adapter.log.info('instance connected to at least one device');
        } else {
            adapter.log.info('instance disconnected from all devices');
        }
        g_isConnected = haveConnection;

        adapter.log.debug('info.connection set to ' + g_isConnected);
        adapter.setState('info.connection', g_isConnected, true);
    }
}

/**
 * validateConfig - scan and validate config data
 *
 * @param
 * @return
 *
 */
function validateConfig() {
    let ok = true;

    const oidSets = {};
    const authSets = {};

    adapter.log.debug('validateConfig - verifying oid-sets');

    if ( adapter.config.optUseName ) {
        adapter.log.warn('Option compatibility mode has been deprecated; please consider to adapt config.');
    }

    // ensure that at least empty config exists
    adapter.config.oids = adapter.config.oids || [];
    adapter.config.authSets = adapter.config.authSets || [];
    adapter.config.devs = adapter.config.devs || [];

    if (!adapter.config.oids.length) {
        adapter.log.error('no oids configured, please add configuration.');
        ok = false;
    }

    for (let ii = 0; ii < adapter.config.oids.length; ii++) {
        const oid = adapter.config.oids[ii];

        if (!oid.oidAct) continue;

        oid.oidGroup = (oid.oidGroup||'').trim();
        oid.oidName = (oid.oidName||'').trim();
        oid.oidOid = (oid.oidOid||'').trim().replace(/^\./, '');

        const oidGroup = oid.oidGroup;

        if (!oid.oidGroup) {
            adapter.log.error('oid group must not be empty, please correct configuration.');
            ok = false;
        }

        if (!oid.oidName) {
            adapter.log.error('oid name must not be empty, please correct configuration.');
            ok = false;
        }

        // as ids must not end with a dot, the name must not end with a dot too
        // duplicate dots would result in empty folder names
        if (oid.oidName.endsWith('.')) {
            adapter.log.error('oid "' + oid.oidName + '"is invalid. Name must not end with ".". Please correct configuration.');
            ok = false;
        }
        if (oid.oidName.includes('..')) {
            adapter.log.error('oid "' + oid.oidName + '"is invalid. Name must not include consecutive dots. Please correct configuration.');
            ok = false;
        }

        if (!oid.oidOid) {
            adapter.log.error('oid must not be empty, please correct configuration.');
            ok = false;
        }

        if (! /^\d+(\.\d+)*$/.test(oid.oidOid)) {
            adapter.log.error('oid "' + oid.oidOid + '" has invalid format, please correct configuration.');
            ok = false;
        }

        // TODO: oidGroup                       must be unique
        // TODO: oidGroup + oidName             must be unique
        // TODO: oidGroup + oidName + oidOid    must be unique

        oidSets[oidGroup] = true;

    }

    if (!ok) {
        adapter.log.debug('validateConfig - validation aborted (checks failed)');
        return false;
    }

    adapter.log.debug('validateConfig - verifying authorization data');

    for (let ii = 0; ii < adapter.config.authSets.length; ii++) {
        const authSet = adapter.config.authSets[ii];
        const authId = authSet.authId;
        if (!authId || authId == '') {
            adapter.log.error('empty authorization id detected, please correct configuration.');
            ok = false;
            continue;
        }
        if (authSets[authId]) {
            adapter.log.error('duplicate authorization id ' + authId + ' detected, please correct configuration.');
            ok = false;
            continue;
        }
        authSets[authId] = true;
    }

    if (!ok) {
        adapter.log.debug('validateConfig - validation aborted (checks failed)');
        return false;
    }

    adapter.log.debug('validateConfig - verifying devices');

    if (!adapter.config.devs.length) {
        adapter.log.error('no devices configured, please add configuration.');
        ok = false;
    }

    for (let ii = 0; ii < adapter.config.devs.length; ii++) {
        const dev = adapter.config.devs[ii];

        if (!dev.devAct) continue;

        dev.devName = (dev.devName||'').trim();
        dev.devIpAddr = (dev.devIpAddr||'').trim();
        dev.devOidGroup = (dev.devOidGroup||'').trim();
        dev.devAuthId = (dev.devAuthId||'').trim();
        //dev.devTimeout = dev.devTimeout;
        //dev.devRetryIntvl = dev.devRetryIntvl;
        //dev.devPollIntvl = dev.devPollIntvl;

        // devicename is required, must not end with a dot or contain consecutive dots
        if (!dev.devName) {
            adapter.log.error('device name must not be empty, please correct configuration.');
            ok = false;
        }
        if (dev.devName.endsWith('.')) {
            adapter.log.error('devicename "' + dev.devName + '"is invalid. Name must not end with ".". Please correct configuration.');
            ok = false;
        }
        if (dev.devName.includes('..')) {
            adapter.log.error('devicename "' + dev.devName + '"is invalid. Name must not include consecutive dots. Please correct configuration.');
            ok = false;
        }

        // IPv4, IPv6 address or dsn name
        // allowed formats:
        // mynode.domain.com, mynode.domain.com:123 - domainnamen with or without port
        // 1.2.3.4, 1.2.3.4:123 - IPv4 with or without port
        // 8001:1234:ffff::1234 - IPv6 without port
        // [8001:1234:ffff::1234], [8001:1234:ffff::1234]:123 - IPv6 with or without domain name
        adapter.log.debug('ip address "' + dev.devIpAddr + '" will be checked for ' + (dev.devIp6?'IPv6':'IPv4'));
        if (dev.devIp6)
        {
            // IPv6 address or dsn name
            const tmp = dev.devIpAddr.match(/^\[([0-9a-fA-F:.]+)\](:\d+)?$/);
            if ( tmp ) {
                adapter.log.debug('ip address "' + dev.devIpAddr + '" bracket notation detected');
                if (! net.isIPv6( tmp[1] ) ) {
                    adapter.log.error('ip address "' + tmp[1] + '" is no valid ipv6 address, please correct configuration.');
                    ok = false;
                } else {
                    adapter.log.debug('ip address "' + dev.devIpAddr + '" address check passed');
                }
            } else if (/^[0-9a-fA-F:.]+$/.test(dev.devIpAddr)) {
                adapter.log.debug('ip address "' + dev.devIpAddr + '" plain numeric notation detected');
                if (! net.isIPv6( dev.devIpAddr ) ) {
                    adapter.log.error('ip address "' + dev.devIpAddr + '" is no valid ipv6 address, please correct configuration.');
                    ok = false;
                } else {
                    adapter.log.debug('ip address "' + dev.devIpAddr + '" address check passed');
                }
            } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
                adapter.log.debug('ip address "' + dev.devIpAddr + '" domain name detected');
            } else {
                adapter.log.error('ip address "' + dev.devIpAddr + '" has invalid format for ipv6, please correct configuration.');
                ok = false;
            }
        } else {
            // IPv4 address or dsn name
            if (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(dev.devIpAddr)) {
                adapter.log.debug('ip address "' + dev.devIpAddr + '" numeric notation detected');
                const tmp = dev.devIpAddr.split(':');
                if (! net.isIPv4( tmp[0] ) ) {
                    adapter.log.error('ip address "' + dev.devIpAddr + '" is no valid ipv4 address, please correct configuration.');
                    ok = false;
                } else {
                    adapter.log.debug('ip address "' + dev.devIpAddr + '" address check passed');
                }
            } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
                adapter.log.debug('ip address "' + dev.devIpAddr + '" domain name detected');
            } else {
                adapter.log.error('ip address "' + dev.devIpAddr + '" has invalid format for ipv4, please correct configuration.');
                ok = false;
            }
        }

        if (!dev.devOidGroup || dev.devOidGroup == '') {
            adapter.log.error('device "' + dev.devName + '" (' + dev.devIpAddr + ') does not specify a oid group. Please correct configuration.');
            ok = false;
        }

        if (dev.devOidGroup && dev.devOidGroup != '' && !oidSets[dev.devOidGroup]) {
            adapter.log.warn('device "' + dev.devName + '" (' + dev.devIpAddr + ') references unknown or completly inactive oid group ' + dev.devOidGroup + '. Please correct configuration.');
            //ok = false;
        }

        if (dev.devSnmpVers == SNMP_V3 && dev.authId == '') {
            adapter.log.error('device "' + dev.devName + '" (' + dev.devIpAddr + ') requires valid authorization id. Please correct configuration.');
            ok = false;
        }

        if (dev.devSnmpVers == SNMP_V3 && dev.devAuthId != '' && !authSets[dev.devAuthId]) {
            adapter.log.error('device "' + dev.devName + '" (' + dev.devIpAddr + ') references unknown authorization group ' + dev.devAuthId + '. Please correct configuration.');
            ok = false;
        }

        if (!/^\d+$/.test(dev.devTimeout)) {
            adapter.log.error('device "' + dev.devName + '" - timeout (' + dev.devTimeout + ') must be numeric, please correct configuration.');
            ok = false;
        }
        dev.devTimeout = parseInt(dev.devTimeout, 10) || 5;
        if (dev.devTimeout > 600) { // must be less than 0x7fffffff / 1000
            adapter.log.warn('device "' + dev.devName + '" - device timeout (' + dev.devTimeout + ') must be less than 600 seconds, please correct configuration.');
            dev.devTimeout = 600;
            adapter.log.warn('device "' + dev.devName + '" - device timeout set to 600 seconds.');
        }
        if (dev.devTimeout < 1) {
            adapter.log.warn('device "' + dev.devName + '" - device timeout (' + dev.devTimeout + ') must be at least 1 second, please correct configuration.');
            dev.devTimeout = 1;
            adapter.log.warn('device "' + dev.devName + '" - device timeout set to 1 second.');
        }

        if (!/^\d+$/.test(dev.devRetryIntvl)) {
            adapter.log.error('device "' + dev.devName + '" - retry intervall (' + dev.devRetryIntvl + ') must be numeric, please correct configuration.');
            ok = false;
        }
        dev.devRetryIntvl = parseInt(dev.devRetryIntvl, 10) || 5;
        if (dev.devRetryIntvl > 3600) { // must be less than 0x7fffffff / 1000
            adapter.log.warn('device "' + dev.devName + '" - retry intervall (' + dev.devRetryIntvl + ') must be less than 3600 seconds, please correct configuration.');
            dev.devRetryIntvl = 3600;
            adapter.log.warn('device "' + dev.devName + '" - retry intervall set to 3600 seconds.');
        }
        if (dev.devRetryIntvl < 1) {
            adapter.log.warn('device "' + dev.devName + '" - retry intervall (' + dev.devRetryIntvl + ') must be at least 1 second, please correct configuration.');
            dev.devRetryIntvl = 1;
            adapter.log.warn('device "' + dev.devName + '" - retry intervall set to 1 second.');
        }

        if (!/^\d+$/.test(dev.devPollIntvl)) {
            adapter.log.error('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be numeric, please correct configuration.');
            ok = false;
        }
        dev.devPollIntvl = parseInt(dev.devPollIntvl, 10) || 30;
        if (dev.devPollIntvl > 3600) { // must be less than 0x7fffffff / 1000
            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be less than 3600 seconds, please correct configuration.');
            dev.devPollIntvl = 3600;
            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to 3600 seconds.');
        }
        if (dev.devPollIntvl < 5) {
            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be at least 5 seconds, please correct configuration.');
            dev.devPollIntvl = 5;
            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to 5 seconds.');
        }
        if (dev.devPollIntvl <= dev.devTimeout) {
            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be larger than device timeout (' + dev.devTimeout + '), please correct configuration.');
            dev.devPollIntvl = dev.devTimeout + 1;
            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to ' + dev.devPollIntvl + ' seconds.');
        }
    }

    if (!ok) {
        adapter.log.debug('validateConfig - validation aborted (checks failed)');
        return false;
    }

    adapter.log.debug('validateConfig - validation completed (checks passed)');
    return true;
}

/**
 * setupContices - setup contices for worker threads
 *
 * @param
 * @return
 *
 *	CTX		object containing data for one device
 *			it has the following attributes
 *		ip			string 	ip address of target device
 *		ipStr		string	ip address of target device with invalid chars removed
 *		OIDs		array of OID objects
 *		oids		array of oid strings (used for snmp call)
 *		ids			array of id strings (index syncet o oids array)
 * 		authId 	    string 	snmp community (snmp V1, V2 only)
 *		initialized	boolean	true if connection is initialized
 *		inactive	boolean	true if connection to device is active
 */
function setupContices() {
    adapter.log.debug('setupContices - initializing contices');

    for (let ii = 0, jj = 0; ii < adapter.config.devs.length; ii++) {
        const dev = adapter.config.devs[ii];

        if (!dev.devAct) {
            continue;
        }

        adapter.log.debug('adding device "' + dev.devIpAddr + '" (' + dev.devName + ') , snmp id: ' + dev.devSnmpVers);
        adapter.log.debug('timing parameter: timeout ' + dev.devTimeout + 's , retry ' + dev.devRetryIntvl + 's, polling ' + dev.devPollIntvl + 's');

        let ipAddr = '';
        let ipPort = 161;
        if (dev.devIp6 ) {
            // IPv6
            // ffff:0:1234::8abc
            // [ffff:0:1234::8abc] or [ffff:0:1234::8abc]:123
            // mynode.test.com or mynode.test.com:123
            const tmp = dev.devIpAddr.match(/^\[([0-9a-fA-F:.]+)\](:(\d+))?$/);
            if ( tmp ) {
                // brackated ipv6 with optional port attached
                ipAddr = tmp[1];
                ipPort = tmp[3] || 161;
            } else if (/^[0-9a-fA-F:.]+$/.test(dev.devIpAddr)) {
                // numeric ipv6 without port attached
                ipAddr = dev.devIpAddr;
                ipPort = 161;
            } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
                // domain name with optional port attached
                const tmp = dev.devIpAddr.split(':');
                ipAddr = tmp[0];
                ipPort = tmp[1] || 161;
            } else {
                // NOTE: should never occure here
                adapter.log.error('ip address "' + dev.devIpAddr + '" has invalid format for ipv6, please correct configuration.');
            }
        } else {
            // IPv4
            // 1.2.3.4 or 1.2.3.4:123
            // mynode.test.com or mynode.test.com:123
            const tmp = dev.devIpAddr.split(':');
            ipAddr = tmp[0];
            ipPort = tmp[1] || 161;
        }

        CTXs[jj] = {};
        CTXs[jj].name = dev.devName;
        CTXs[jj].ipAddr = ipAddr;
        CTXs[jj].ipPort = ipPort;
        CTXs[jj].id = dev.devName;
        if ( adapter.config.optUseName ) {
            if ( dev.devIp6 ) {
                adapter.log.warn('device "' + dev.devIpAddr + '" (' + dev.devName + ') requests ipv6. Option compatibility mode ignored.');
            } else {
                CTXs[jj].id = ip2ipStr(CTXs[jj].ipAddr);
            }
        }
        CTXs[jj].isIPv6 = dev.devIp6;
        CTXs[jj].timeout = dev.devTimeout * 1000;       //s -> ms must be less than 0x7fffffff
        CTXs[jj].retryIntvl = dev.devRetryIntvl * 1000; //s -> ms must be less than 0x7fffffff
        CTXs[jj].pollIntvl = dev.devPollIntvl * 1000;   //s -> ms must be less than 0x7fffffff
        CTXs[jj].snmpVers = dev.devSnmpVers;
        CTXs[jj].authId = dev.devAuthId;

        if (dev.devSnmpVers == SNMP_V3 ) {
            let authSet = [];
            for (let ii = 0; ii < adapter.config.authSets.length; ii++) {
                if ( adapter.config.authSets[ii].authId == dev.devAuthId ){
                    authSet = adapter.config.authSets[ii];
                }
            }
            CTXs[jj].authSecLvl = authSet.authSecLvl || 0;
            CTXs[jj].authUser = (authSet.authUser || '').trim();
            CTXs[jj].authAuthProto = authSet.authAuthProto || 0;
            CTXs[jj].authAuthKey = (authSet.authAuthKey || '').trim();
            CTXs[jj].authEncProto = authSet.authEncProto || 0;
            CTXs[jj].authEncKey = (authSet.authEncKey || '' ).trim();
        }

        //        CTXs[jj].OIDs = [];
        //        CTXs[jj].oids = [];
        //        CTXs[jj].ids = [];
        CTXs[jj].chunks = [];

        CTXs[jj].pollTimer = null;  // poll intervall timer
        CTXs[jj].session = null;    // snmp session
        CTXs[jj].inactive = true;   // connection status of device

        let cIdx = -1;    // chunk index
        let cCnt = 0;     // chunk element count

        for (let oo = 0; oo < adapter.config.oids.length; oo++) {
            const oid = adapter.config.oids[oo];

            // skip inactive oids and oids belonging to other oid groups
            if (!oid.oidAct) continue;
            if (dev.devOidGroup != oid.oidGroup) continue;

            const id = CTXs[jj].id + '.' + name2id(oid.oidName);
            if (cCnt <= 0 )
            {
                cIdx++;
                CTXs[jj].chunks.push([]);
                CTXs[jj].chunks[cIdx].OIDs = [];
                CTXs[jj].chunks[cIdx].oids = [];
                CTXs[jj].chunks[cIdx].ids = [];
                cCnt = g_chunkSize;
                adapter.log.debug('       oid chunk index ' + cIdx + ' created');
            }
            //            CTXs[jj].oids.push(oid.oidOid);
            //            CTXs[jj].ids.push(id);
            //            CTXs[jj].OIDs.push(oid);
            CTXs[jj].chunks[cIdx].oids.push(oid.oidOid);
            CTXs[jj].chunks[cIdx].ids.push(id);
            CTXs[jj].chunks[cIdx].OIDs.push(oid);
            cCnt--;

            adapter.log.debug('       oid "' + oid.oidOid + '" (' + id + ')');
        }

        jj++;
    }
}

// #################### adapter main functions ####################

/**
 * onReady - will be called as soon as adapter is ready
 *
 * @param
 * @return
 *
 */
async function onReady() {

    adapter.log.debug('onReady triggered');

    if (doInstall) {
        const instUtils = new InstallUtils(adapter);

        adapter.log.info('performing installation');
        await instUtils.doUpgrade();
        adapter.log.info('installation completed');

        didInstall = true;
        adapter.terminate('exit after migration of config', EXIT_CODES.NO_ERROR);
        return; // shut down as soon as possible
    }

    {
        const cfgVers = adapter.config.cfgVers || '0';
        const OIDs = adapter.config.OIDs;

        if (cfgVers == 0 || OIDs) {
            const instUtils = new InstallUtils(adapter);
            adapter.log.info('performing delayed installation');
            await instUtils.doUpgrade(adapter.instance);
            adapter.log.info('installation completed');

            didInstall = true;
            if (await instUtils.doRestart) {
                adapter.terminate('restart after migration of config', EXIT_CODES.NO_ERROR);
                return; // shut down as soon as possible
            }
        }
    }

    {
        const instUtils = new InstallUtils(adapter);
        adapter.log.debug('update check for config');
        await instUtils.doUpdate(adapter.instance);
        adapter.log.debug('update check for config completed');

        if (await instUtils.doRestart) {
            adapter.terminate('restart after update of config', EXIT_CODES.NO_ERROR);
            return; // shut down as soon as possible
        }

    }
    // mark adapter as non active
    await adapter.setStateAsync('info.connection', false, true);

    // validate config
    if (!validateConfig()) {
        adapter.log.error('invalid config, cannot continue');
        adapter.disable();
        return;
    }

    // read global config
    g_chunkSize = adapter.config.optChunkSize || 20;
    adapter.log.info('adapter initializing, chunk size set to ' + g_chunkSize);

    // setup worker thread contices
    setupContices();

    // init all objects
    await initAllObjects();

    adapter.log.debug('initialization completed');

    // start one reader thread per device
    adapter.log.debug('starting reader threads');
    for (let ii = 0; ii < CTXs.length; ii++) {
        const CTX = CTXs[ii];
        createSession(CTX);
    }

    // start connection info updater
    adapter.log.debug('startconnection info updater');
    g_connUpdateTimer = setInterval(handleConnectionInfo, 15000);

    adapter.log.debug('startup completed');

}

/**
 * onUnload - called when adapter shuts down
 *
 * @param {callback} callback 	callback function
 * @return
 *
 */
function onUnload(callback) {
    adapter.log.debug('onUnload triggered');

    for (let ii = 0; ii < CTXs.length; ii++) {
        const CTX = CTXs[ii];

        // (re)set device online status
        try {
            adapter.setState(CTX.id + '.online', false, true);
        } catch (e) { /* */ }

        // close session if one exists
        if (CTX.pollTimer) {
            try {
                clearInterval(CTX.pollTimer);
            } catch (e) { /* */ }
            CTX.pollTimer = null;
        }

        if (CTX.session) {
            try {
                CTX.session.on('error', null); // avoid nesting callbacks
                CTX.session.on('close', null); // avoid nesting callbacks
                CTX.session.close();
            } catch (e) { /* */ }
            CTX.session = null;
        }
    }

    if (g_connUpdateTimer) {
        try {
            clearInterval(g_connUpdateTimer);
        } catch (e) { /* */ }
        g_connUpdateTimer = null;
    }

    try {
        adapter.setState('info.connection', false, true);
    } catch (e) { /* */ }

    // callback must be called under all circumstances
    callback && callback();
}

/**
 * here we start
 */
console.log('DEBUG  : snmp adapter initializing (' + process.argv + ') ...'); //logger not yet initialized

if (process.argv) {
    for (let a = 1; a < process.argv.length; a++) {
        if (process.argv[a] === '--install') {
            doInstall = true;
            process.on('exit', function () {
                if (!didInstall) {
                    console.log('WARNING: migration of config skipped - ioBroker might be stopped');
                }
            });
        }
    }
}

if (require.main !== module) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}
