/**
 *
 * snmp adapter,
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022-2023, MIT
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
 *      devId      string   devId of device, dereived from ip address or from name
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
 */

/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';

const F_TEXT = 0;
const F_NUMERIC = 1;
const F_BOOLEAN = 2;
const F_JSON = 3;
const F_AUTO = 99;

// snmp protocols
const SNMP_V1 = 1;
const SNMP_V2c = 2;
const SNMP_V3 = 3;

// authentication protocols
const MD5 = 1;
const SHA = 2;
const SHA224 = 3;
const SHA256 = 4;
const SHA384 = 5;
const SHA512 = 6;

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
const adapterName = require('./package.json').name.split('.').pop();

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
const STATEs = [];          // states cache, index by full id
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
        stateChange: onStateChange,

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
        case F_AUTO /* 99 */: {
            return 'mixed';
        }
        default:{
            adapter.log.warn('oidFormat2StateType - unknown code ' + pOidFormat );
            return 'mixed';
        }
    }
}

// #################### object initialization functions ####################

/**
 * cleanupStates - cleanup unused states
 *
 * @param   {string}    pPattern    pattern to match state id
 *
 * @return  objects
 *
 */
async function delStates( pPattern ) {
    adapter.log.debug ( 'delStates ('+pPattern+')');

    const objs = await adapter.getForeignObjectsAsync( `${adapterName}.${adapter.instance}.${pPattern}` );
    if (objs){
        if ( Object.values(objs).length ) {
            adapter.log.info(`removing states ${pPattern}...`);
        }
        for (const obj of Object.values(objs)) {
            adapter.log.debug(`removing object ${obj._id}...`);
            await adapter.delForeignObjectAsync( obj._id, {recursive: true} );
        }
    }
}

/**
 * cleanupStates - cleanup unused states
 *
 * @return  nothing
 *
 */
async function cleanupStates() {
    adapter.log.debug('cleanupStates ');

    // delete -rap states if no lonager enabled
    if ( ! adapter.config.optRawStates )
    {
        await delStates ( '*-raw' );
    }

    // delete -type states if no lonager enabled
    if ( ! adapter.config.optTypeStates )
    {
        await delStates ( '*-type' );
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

    const fullId = `${adapterName}.${adapter.instance}.${pObj._id}`;

    if (typeof(STATEs[fullId]) === 'undefined') {
        try {
            adapter.log.debug('creating obj "' + pObj._id + '" with type ' + pObj.type);
            await adapter.setObjectNotExistsAsync(pObj._id, pObj);
            await adapter.extendObjectAsync(pObj._id, pObj);
        } catch (e) {
            adapter.log.error('error initializing obj "' + pObj._id + '" ' + e.message);
        }
        STATEs[fullId] = {
            type: pObj.type,
            commonType: null,
        };
    }

    if (pObj.type === 'state') {
        if ( (typeof (STATEs[fullId].commonType) === 'undefined' ) ||
             (STATEs[fullId].commonType === null ) ) {
            const obj = await adapter.getObjectAsync(pObj._id);
            STATEs[fullId] = {
                commonType: obj.common.type
            };
        }

        if ( STATEs[fullId].commonType !== pObj.common.type ) {
            try {
                adapter.log.info('reinitializing obj "' + pObj._id + '" state-type change '+STATEs[fullId].commonType+' -> '+pObj.common.type);
                await adapter.extendObjectAsync(pObj._id, {common: { type: pObj.common.type }});
                STATEs[fullId].commonType = pObj.common.type;
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
                name: pIp,
                statusStates: {
                    onlineId: `${adapterName}.${adapter.instance}.${pId}.online`,
                    errorId: `${adapterName}.${adapter.instance}.${pId}.alarm`
                }
            },
            native: {
            }
        }
        );

        // create <ip>.online and .alarm state objects
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
        await initObject({
            _id: pId + '.alarm',
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
        await initObject({
            _id: pId + '.last_error',
            type: 'state',
            common: {
                name: pIp + ' last error',
                write: false,
                read: true,
                type: 'string',
                role: 'text'
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
                write: !!pOID.oidWriteable,
                read: true,
                type: oidFormat2StateType(pOID.oidFormat),
                role: 'value'
            },
            native: {
            }
        });

        if (pOID.oidWriteable) {
            const fullId = `${adapterName}.${adapter.instance}.${pId}`;
            adapter.log.debug ( `subscribing state ${fullId}` );
            await adapter.subscribeStatesAsync( fullId );
        }

        if (adapter.config.optTypeStates) {
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
        }

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


// #################### varbind convert functions ####################
/**
 * oidObjType2Text - translate oid object type into textual string
 *
 * @param   {integer}   pOidObjType    oid object type
 * @return  {string}    textual representation of object type
 *
 */
function oidObjType2Text( pOidObjType ) {
    adapter.log.debug('oidObjType2Text - stringify oid object type');

    const OBJECT_TYPE ={
        [snmp.ObjectType.Boolean]       : 'Boolean',
        [snmp.ObjectType.Integer]       : 'Integer',
        [snmp.ObjectType.OctetString]   : 'OctetString',
        [snmp.ObjectType.Null]          : 'Null',
        [snmp.ObjectType.OID]           : 'OID',
        [snmp.ObjectType.IpAddress]     : 'IpAddress',
        [snmp.ObjectType.Counter]       : 'Counter',
        [snmp.ObjectType.Gauge]         : 'Gauge',
        [snmp.ObjectType.TimeTicks]     : 'TimeTicks',
        [snmp.ObjectType.Opaque]        : 'Opaque',
        [snmp.ObjectType.Integer32]     : 'Integer32',
        [snmp.ObjectType.Counter32]     : 'Counter32',
        [snmp.ObjectType.Gauge32]       : 'Gauge32',
        [snmp.ObjectType.Unsigned32]    : 'Unsigned32',
        [snmp.ObjectType.Counter64]     : 'Counter64',
        [snmp.ObjectType.NoSuchObject]  : 'NoSuchObject',
        [snmp.ObjectType.NoSuchInstance]: 'NoSuchInstance',
        [snmp.ObjectType.EndOfMibView]  : 'EndOfMibView',
    };

    return OBJECT_TYPE[pOidObjType] || `Unknown (${pOidObjType})`;
}

/**
 * varbindDecode - convert varbind data to native data
 *
 * @param   {object}    pVarbind    varbind to decode
 * @param   {integer}   pFormat     format constant
 * @param   {string}    pDevId      id of device
 * @param   {string}    pStateId    id of state
 * @return  {object}    state object containing val, typestr and qual values
 *
 */
function varbindDecode( pVarbind, pFormat, pDevId, pStateId ) {
    adapter.log.debug('varbindDeode - decode varbind');

    // taken from https://github.com/markabrahams/node-net-snmp#oid-strings--varbinds
    // varbind data is encoded based on snmp.ObjectType object.
    //
    // The JavaScript true and false keywords are used for the values of varbinds with type Boolean.
    //
    // All integer based types are specified as expected (this includes Integer, Counter, Gauge, TimeTicks, Integer32,
    // Counter32, Gauge32, and Unsigned32), e.g. -128 or 100.
    //
    // Since JavaScript does not offer full 64 bit integer support objects with type Counter64 cannot be supported in the same way
    // as other integer types, instead Node.js Buffer objects are used. Users are responsible for producing (i.e. for set() requests)
    // and consuming (i.e. the varbinds passed to callback functions) Buffer objects. That is, this module does not work with
    // 64 bit integers, it simply treats them as opaque Buffer objects.
    //
    // Dotted decimal strings are used for the values of varbinds with type OID, e.g. 1.3.6.1.2.1.1.5.0.
    //
    // Dotted quad formatted strings are used for the values of varbinds with type IpAddress, e.g. 192.168.1.1.
    //
    // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
    // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
    //
    // The NoSuchObject, NoSuchInstance and EndOfMibView types are used to indicate an error condition. Currently there is
    // no reason for users of this module to to build varbinds using these types.
    //

    const retval = {
        val:        null,
        typeStr:    oidObjType2Text(pVarbind.type),
        qual:       0x00, // assume OK
        format:     pFormat
    };
    //

    switch (pVarbind.type) {
    // The JavaScript true and false keywords are used for the values of varbinds with type Boolean.
        case snmp.ObjectType.Boolean: {
            switch (pFormat) {
                case F_TEXT /* 0 */:
                default:
                    retval.val = pVarbind.value.toString();
                    break;
                case F_NUMERIC /* 1 */:
                    retval.val = pVarbind.value?1:0;
                    break;
                case F_BOOLEAN /* 2 */:
                case F_AUTO /* 99 */:
                    retval.val = pVarbind.value;
                    retval.format = F_BOOLEAN;
                    break;
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify({type: 'boolean', data: pVarbind.value});
                    break;
            }
            break;
        }

        // All integer based types are specified as expected
        case snmp.ObjectType.Integer:
        case snmp.ObjectType.Counter:
        case snmp.ObjectType.Gauge:
        case snmp.ObjectType.TimeTicks:
        case snmp.ObjectType.Integer32:
        case snmp.ObjectType.Counter32:
        case snmp.ObjectType.Gauge32:
        case snmp.ObjectType.Unsigned32: {
            switch (pFormat) {
                case F_TEXT /* 0 */:
                default:
                    retval.val = pVarbind.value.toString();
                    break;
                case F_NUMERIC /* 1 */:
                case F_AUTO /* 99 */:
                    //retval.val = parseInt(pVarbind.value.toString(), 10);
                    retval.val = pVarbind.value;
                    if (isNaN(retval.val)) retval.qual=0x01; // general error
                    retval.format = F_NUMERIC;
                    break;
                case F_BOOLEAN /* 2 */: {
                    const valint = pVarbind.value;
                    retval.val = valint !== 0;
                    if (isNaN (valint)) retval.qual=0x01; // general error
                    break;
                }
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify({type: 'number', data: pVarbind.value});
                    break;
            }
            break;
        }

        // Since JavaScript does not offer full 64 bit integer support objects with type Counter64 cannot be supported in the same way
        // as other integer types, instead Node.js Buffer objects are used. Users are responsible for producing (i.e. for set() requests)
        // and consuming (i.e. the varbinds passed to callback functions) Buffer objects.
        case snmp.ObjectType.Counter64:{
            // convert buffer to string using bigin
            let value = BigInt(0); //bigint constant
            for (let ii= 0; ii<pVarbind.value.length; ii++){
                value=value*BigInt(256) + BigInt(pVarbind.value[ii]);
            }
            switch (pFormat) {
                case F_TEXT /* 0 */:
                default:
                    retval.val = value.toString();
                    break;
                case F_NUMERIC /* 1 */:
                case F_AUTO /* 99 */:
                    retval.val = Number(value);
                    if (isNaN(retval.val)) retval.qual=0x01; // general error
                    retval.format = F_NUMERIC;
                    break;
                case F_BOOLEAN /* 2 */: {
                    const valint = Number(value);
                    retval.val =  valint !== 0;
                    if (isNaN (valint)) retval.qual=0x01; // general error
                    break;
                }
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify({type: 'number', data: pVarbind.value});
                    break;
            }
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
        // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
        case snmp.ObjectType.OctetString: {
            switch (pFormat) {
                case F_TEXT /* 0 */:
                case F_AUTO /* 99 */:
                default:
                    retval.val = pVarbind.value.toString();
                    retval.format = F_TEXT;
                    break;
                case F_NUMERIC /* 1 */: {
                    const valint = parseInt(pVarbind.value.toString, 10);
                    retval.val = valint;
                    if (isNaN (valint)) retval.qual=0x01; // general error
                    break;
                }
                case F_BOOLEAN /* 2 */: {
                    const valint = parseInt(pVarbind.value.toString, 10);
                    retval.val = valint !== 0;
                    if (isNaN (valint)) retval.qual=0x01; // general error
                    break;
                }
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify(pVarbind.value); /* type: Buffer */
                    break;
            }
            break;
        }

        // no dcumentation for type null available
        case snmp.ObjectType.Null: {
            retval.val = null;
            retval.qual = 0x1; // general error
            retval.format = F_TEXT;
            adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert data of type null` + JSON.stringify(pVarbind));
            break;
        }

        // Dotted decimal strings are used for the values of varbinds with type OID, e.g. 1.3.6.1.2.1.1.5.0.
        case snmp.ObjectType.OID: {
            switch (pFormat) {
                case F_TEXT /* 0 */:
                case F_AUTO /* 99 */:
                default:
                    retval.val = pVarbind.value.toString();
                    retval.format = F_TEXT;
                    break;
                case F_NUMERIC /* 1 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert data of type oid to numeric ` + JSON.stringify(pVarbind));
                    break;
                case F_BOOLEAN /* 2 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert data of type oid to boolean ` + JSON.stringify(pVarbind));
                    break;
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify(pVarbind.value); /* Buffer */
                    break;
            }
            break;
        }

        // Dotted quad formatted strings are used for the values of varbinds with type IpAddress, e.g. 192.168.1.1.
        case snmp.ObjectType.IpAddress:{
            switch (pFormat) {
                case F_TEXT /* 0 */:
                case F_AUTO /* 99 */:
                default:
                    retval.val = pVarbind.value.toString();
                    retval.format = F_TEXT;
                    break;
                case F_NUMERIC /* 1 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert data of type ipaddress to numeric ` + JSON.stringify(pVarbind));
                    break;
                case F_BOOLEAN /* 2 */:
                    retval.val = null;
                    retval.qual = 0x1; // general error
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert data of type ipaddress to boolean ` + JSON.stringify(pVarbind));
                    break;
                case F_JSON /* 3 */:
                    retval.val = JSON.stringify(pVarbind.value); /* Buffer */
                    break;
            }
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString.
        // NOTE: currently only a heuristic implementation for floating point number is implemented for formats other than json.
        case snmp.ObjectType.Opaque:{
            if ( pVarbind.value.length === 7 &&
                pVarbind.value[0] === 159 &&
                pVarbind.value[1] === 120 &&
                pVarbind.value[2] === 4 ) {
                const value = pVarbind.value.readFloatBE(3);
                switch (pFormat) {
                    case F_TEXT /* 0 */:
                    default:
                        retval.val = value.toString();
                        break;
                    case F_NUMERIC /* 1 */:
                    case F_AUTO /* 99 */:
                        retval.val = value;
                        retval.format = F_NUMERIC;
                        break;
                    case F_BOOLEAN /* 2 */:
                        retval.val = value !== 0;
                        break;
                    case F_JSON /* 3 */:
                        retval.val = JSON.stringify(pVarbind.value); /* Buffer */
                        break;
                }
            } else {
                retval.val = null;
                retval.qual = 0x1; // general error
                retval.format = F_TEXT;
                adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert opaque data` + JSON.stringify(pVarbind));
            }
            break;
        }

        case snmp.ObjectType.NoSuchObject:
        case snmp.ObjectType.NoSuchInstance:
        case snmp.ObjectType.EndOfMibView:
        default:
            retval.val = null;
            retval.qual = 0x1; // general error
            retval.format = F_TEXT;
            adapter.log.warn(`[${pDevId}] ${pStateId} cannot convert data` + JSON.stringify(pVarbind));
            break;
    }

    return retval;
}

/**
*/
function json2buffer(pJson){
    adapter.log.debug(`json2buffer - ${pJson}`);

    let json = {};
    try {
        json=JSON.parse(pJson);
    } catch (e) {
        adapter.log.warn(`cannot parse json data ${e.error} - ${pJson}`);
        return null;
    }

    if (json.type !== 'Buffer') {
        adapter.log.warn(`cannot convert json data, type must be Buffer - ${pJson}`);
        return null;
    }

    if (!json.data){
        adapter.log.warn(`cannot convert json data, data element missing - ${pJson}`);
        return null;
    }

    return Buffer.from(json.data);
}

function json2boolean(pJson){
    adapter.log.debug(`json2buffer - ${pJson}`);

    let json = {};
    try {
        json=JSON.parse(pJson);
    } catch (e) {
        adapter.log.warn(`cannot parse json data ${e.error} - ${pJson}`);
        return null;
    }

    if (json.type !== 'boolean') {
        adapter.log.warn(`cannot convert json data, type must be boolean - ${pJson}`);
        return null;
    }

    if (!json.data){
        adapter.log.warn(`cannot convert json data, data element missing - ${pJson}`);
        return null;
    }

    return Number(json.data) != 0;
}

function json2number(pJson){
    adapter.log.debug(`json2buffer - ${pJson}`);

    let json = {};
    try {
        json=JSON.parse(pJson);
    } catch (e) {
        adapter.log.warn(`cannot parse json data ${e.error} - ${pJson}`);
        return null;
    }

    if (json.type !== 'number') {
        adapter.log.warn(`cannot convert json data, type must be number - ${pJson}`);
        return null;
    }

    if (!json.data){
        adapter.log.warn(`cannot convert json data, data element missing - ${pJson}`);
        return null;
    }

    return Number(json.data);
}

/**
 * varbindEncode - convert native data to varbind data
 *
 * @param   {object}    pVarbind    varbind template
 * @param   {any}       pData       data to store in varbind
 * @param   {string}    pDevId      id of device
 * @param   {string}    pStateId    id of state
 * @return  {object}    varbind object containing data
 *
 */
function varbindEncode( pState, pData, pDevId, pStateId ) {
    adapter.log.debug('varbindEncode - encode varbind');

    const retval = {
        oid:        pState.varbind.oid,
        type:       pState.varbind.type,
        value:      null
    };

    let dataType = typeof(pData);
    switch (dataType) {
        case 'boolean':
        case 'number':
            break; /* ok, we can handle it */

        case 'string':
            if (pState.format === F_JSON) dataType='json'; /* json must be handled special */
            break; /* ok, we can handle it */

        default:
            retval.value = null;
            adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode data of type ${dataType} - ` + pData);
            return retval;
    }

    switch (pState.varbind.type) {
        // The JavaScript true and false keywords are used for the values of varbinds with type Boolean.
        case snmp.ObjectType.Boolean: {
            switch (dataType) {
                case 'string':
                    retval.value = pData.toString() == 'true';
                    break;
                case 'number':
                    retval.value = pData != 0;
                    break;
                case 'boolean':
                    retval.value = pData;
                    break;
                case 'json':
                    retval.value = json2boolean(pData);
                    break;
            }
            break;
        }

        // All integer based types are specified as expected
        case snmp.ObjectType.Integer:
        case snmp.ObjectType.Counter:
        case snmp.ObjectType.Gauge:
        case snmp.ObjectType.TimeTicks:
        case snmp.ObjectType.Integer32:
        case snmp.ObjectType.Counter32:
        case snmp.ObjectType.Gauge32:
        case snmp.ObjectType.Unsigned32: {
            switch (dataType) {
                case 'string': {
                    const valint = parseInt(pData, 10);
                    retval.value = valint;
                    if (isNaN (valint)) retval.qual=0x01; // general error
                    break;
                }
                case 'number':
                    retval.value = pData;
                    break;
                case 'boolean': {
                    retval.value = pData?1:0;
                    break;
                }
                case 'json':
                    retval.value = json2number(pData);
                    break;
            }
            break;
        }

        // Since JavaScript does not offer full 64 bit integer support objects with type Counter64 cannot be supported in the same way
        // as other integer types, instead Node.js Buffer objects are used. Users are responsible for producing (i.e. for set() requests)
        // and consuming (i.e. the varbinds passed to callback functions) Buffer objects.
        case snmp.ObjectType.Counter64:{
            // TODO
            retval.value = null;
            adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode data (target counter64) - ` + pData);
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
        // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
        case snmp.ObjectType.OctetString: {
            switch (dataType) {
                case 'string':
                    retval.value = pData;
                    break;
                case 'number':
                    retval.value = pData.toString;
                    break;
                case 'boolean':
                    retval.value = pData.toString;
                    break;
                case 'json':
                    retval.value = json2buffer(pData);
                    break;
            }
            break;
        }

        // no dcumentation for type null available
        case snmp.ObjectType.Null: {
            retval.value = null;
            adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode data (target Null) - ` + pData);
            break;
        }

        // Dotted decimal strings are used for the values of varbinds with type OID, e.g. 1.3.6.1.2.1.1.5.0.
        case snmp.ObjectType.OID: {
            switch (dataType) {
                case 'string':
                    retval.value = pData;
                    break;
                case 'numeric':
                    retval.value = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode NUMERIC data (target OID) - ` + pData);
                    break;
                case 'boolean':
                    retval.val = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode BOOLEAN data (target OID) - ` + pData);
                    break;
                case 'json':
                    retval.value = json2buffer(pData);
                    break;
            }
            break;
        }

        // Dotted quad formatted strings are used for the values of varbinds with type IpAddress, e.g. 192.168.1.1.
        case snmp.ObjectType.IpAddress:{
            switch (dataType) {
                case 'string':
                    retval.value = pData.toString();
                    break;
                case 'numeric':
                    retval.value = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode NUMERIC data (target IP) - ` + pData);
                    break;
                case 'boolean':
                    retval.value = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode BOOLEAN data (target IP) - ` + pData);
                    break;
                case 'json':
                    retval.value = json2buffer(pData);
                    break;
            }
            break;
        }

        // Node.js Buffer objects are used for the values of varbinds with type Opaque and OctetString. For varbinds with type
        // OctetString this module will accept JavaScript strings, but will always give back Buffer objects.
        case snmp.ObjectType.Opaque:{
            switch (dataType) {
                case 'string':
                    retval.value = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode STRIMG data (target opaque) - ` + pData);
                    break;
                case 'numeric':
                    retval.value = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode NUMERIC data (target opaque) - ` + pData);
                    break;
                case 'boolean':
                    retval.value = null;
                    adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode BOOLEAN data (target opaque) - ` + pData);
                    break;
                case 'json':
                    retval.value = json2buffer(pData);
                    break;
            }
            break;
        }

        case snmp.ObjectType.NoSuchObject:
        case snmp.ObjectType.NoSuchInstance:
        case snmp.ObjectType.EndOfMibView:
        default: {
            retval.value = null;
            adapter.log.warn(`[${pDevId}] ${pStateId} cannot encode data (target default)` + pData);
            break;
        }
    }
    return retval;
}

// #################### snmp session handling functions ####################

/**
 * snmpSessionGetAsync - async version of snmp.session.get
 *
 * @param   {object}    pSession    snmp session refernece
 * @param   {object}    pOids       snmp oids array
 *
 * @return  {object}                object containing { error, varbinds } as returned by snmp.session.get
 *
 */

async function snmpSessionGetAsync( pSession, pOids) {
    return new Promise((resolve,_reject)=>{
        const ret={
            err: null,
            varbinds: []
        };

        if (! pSession) {
            adapter.log.debug( 'session vanished, skipping get oparation');
            ret.err = 'no active session';
            resolve(ret);
        } else {
            pSession.get (pOids, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds;
                resolve(ret);
            });
        }
    });
}

/**
 * snmpSessionSetAsync - async version of snmp.session.set
 *
 * @param   {object}    pSession    snmp session refernece
 * @param   {object}    pVarbinds   snmp varbinds array
 *
 * @return  {object}                object containing { error, varbinds } as returned by snmp.session.set
 *
 */
async function snmpSessionSetAsync( pSession, pVarbinds) {
    return new Promise((resolve,_reject)=>{
        const ret={
            err: null,
            varbinds: null
        };

        if (! pSession) {
            adapter.log.debug( 'session vanished, skipping set operation');
            ret.err = 'no active session';
            resolve(ret);
        } else {
            pSession.set (pVarbinds, function (error, varbinds) {
                ret.err = error;
                ret.varbinds = varbinds;
                resolve(ret);
            });
        }
    });
}

/**
 * snmpCreateSession - initializes a snmp session
 *
 * @param   {CTX object}    pCTX    CTX object
 *
 * @return  {object}                session
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
};
*/
async function snmpCreateSession(pCTX) {
    adapter.log.debug('snmpCreateSession - device ' + pCTX.name + ' (' + pCTX.ipAddr + ')');

    const ret = {
        session: null,
        name: pCTX.name,
        ipAddr: pCTX.ipAddr
    };

    // create snmp session for device
    if (pCTX.snmpVers == SNMP_V1 ||
        pCTX.snmpVers == SNMP_V2c) {

        const snmpTransport = pCTX.isIPv6 ? 'udp6' : 'udp4';
        const snmpVersion = (pCTX.snmpVers == SNMP_V1) ? snmp.Version1 : snmp.Version2c;

        ret.session = snmp.createSession(pCTX.ipAddr, pCTX.authId, {
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
        switch (Number(pCTX.authAuthProto)) {   /* ensure numeric type */
            default:
                snmpAuthProtocol = 0;
                break;
            case MD5:
                snmpAuthProtocol = snmp.AuthProtocols.md5;
                break;
            case SHA:
                snmpAuthProtocol = snmp.AuthProtocols.SHA;
                break;
            case SHA224:
                snmpAuthProtocol = snmp.AuthProtocols.SHA224;
                break;
            case SHA256:
                snmpAuthProtocol = snmp.AuthProtocols.SHA256;
                break;
            case SHA384:
                snmpAuthProtocol = snmp.AuthProtocols.SHA384;
                break;
            case SHA512:
                snmpAuthProtocol = snmp.AuthProtocols.SHA512;
                break;
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

        ret.session = snmp.createV3Session(pCTX.ipAddr, snmpUser, {
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

    adapter.log.debug('session for device "' + pCTX.name + '" (' + pCTX.ipAddr + ')' + (ret.session ? '' : ' NOT') + ' created');

    return ret;
}

/**
/**
 * snmpCloseSession - close a snmp session
 *
 * @param   {object}    pSessionCTX    session object
 *
 * @return  nothing
 *
 */
async function snmpCloseSession(pSessCtx ) {
    adapter.log.debug(`snmpCloseSession - device ${pSessCtx.name} (${pSessCtx.ipAddr}`);

    if (pSessCtx.session) {
        try {
            pSessCtx.session.close();
        } catch (e) {
            adapter.log.warn('cannot close session for device "' + pSessCtx.name + '" (' + pSessCtx.ip + '), ' + e);
        }
        pSessCtx.session = null;
    }

    return;
}

/**

/**
 * onReaderSessionClose - callback called whenever a reader session is closed
 *
 * @param {object}      pCTX    CTX object
 * @return
 *
 */
async function onReaderSessionClose(pCTX) {
    adapter.log.debug('onReaderSessionClose - device ' + pCTX.name + ' (' + pCTX.ipAddr + ')');

    adapter.clearInterval(pCTX.pollTimer);
    pCTX.pollTimer = null;
    if( pCTX.sessCtx ) {
        pCTX.sessCtx.session = null;
        pCTX.sessCtx = null;
    }

    pCTX.retryTimer = adapter.setTimeout((pCTX) => {
        pCTX.retryTimer = null;
        createReaderSession(pCTX);
    }, pCTX.retryIntvl, pCTX);
}

/**
 * onReaderSessionError - callback called whenever a reader session encounters an error
 *
 * @param {CTX object} 	pCTX    CTX object
 * @param {object}      pErr    error object
 * @return
 *
 */
async function onReaderSessionError(pCTX, pErr) {
    adapter.log.debug('onReaderSessionError - device ' + pCTX.name + ' (' + pCTX.ipAddr + ') - ' + pErr.toString);

    adapter.log.warn(`device ${pCTX.name} (${pCTX.ipAddr}) reported error ${pErr.toString}`);

    adapter.clearInterval(pCTX.pollTimer);
    pCTX.pollTimer = null;
    pCTX.sessCtx.session = null;
    pCTX.sessCtx = null;

    pCTX.retryTimer = adapter.setTimeout((pCTX) => {
        pCTX.retryTimer = null;
        createReaderSession(pCTX);
    }, pCTX.retryIntvl, pCTX);

}

/**
/**
 * createReaderSession - initializes a snmp reader session for one device and starts the reader thread
 *
 * @param   {object}    pCTX    CTX object
 * @return
 *
 */
async function createReaderSession(pCTX) {
    adapter.log.debug('createReaderSession - device ' + pCTX.name + ' (' + pCTX.ipAddr + ')');

    // (re)set device online and alarm status
    await adapter.setStateAsync(pCTX.id + '.alarm', {val: false, ack: true, q:0x00});
    await adapter.setStateAsync(pCTX.id + '.online', {val: false, ack: true, q:0x00});

    // stop existing timers and close session if one exists
    if (pCTX.retryTimer) {
        adapter.clearTimeout(pCTX.retryTimer);
        pCTX.retryTimer = null;
    }

    if (pCTX.pollTimer) {
        adapter.clearInterval(pCTX.pollTimer);
        pCTX.pollTimer = null;
    }

    if (pCTX.sessCtx) {
        await snmpCloseSession(pCTX.sessCtx);
        pCTX.sessCtx = null;
    }

    // create snmp session for device
    pCTX.sessCtx = await snmpCreateSession(pCTX);

    if (pCTX.sessCtx && pCTX.sessCtx.session) {
        // ok: session created

        pCTX.sessCtx.session.on('close', () => { onReaderSessionClose(pCTX); });
        pCTX.sessCtx.session.on('error', (err) => { onReaderSessionError(pCTX, err); });

        // read one time immediately
        await readOids(pCTX);

        // start recurrent reading
        pCTX.pollTimer = adapter.setInterval(readOids, pCTX.pollIntvl, pCTX);

        adapter.log.debug('session for device "' + pCTX.name + '" (' + pCTX.ipAddr + ') created');

    } else {
        // error: retry again

        adapter.log.debug('session for device "' + pCTX.name + '" (' + pCTX.ipAddr + ') NOT created, will retry');

        pCTX.retryTimer = adapter.setTimeout((pCTX) => {
            pCTX.retryTimer = null;
            createReaderSession(pCTX);
        }, pCTX.retryIntvl, pCTX);

    }

}

/**
 * setStates - set all states related to one oid
 *
 * @param   {string}    pVarbind    (base) state id
 * @param   {object}    pOptions    options object as definded by adapter.setState
 * @param   {object}    pValues     (optional) values object containing values for base, type and json states
 *
 * @return  nothing
 *
 */
async function setStates (pStateId, pOptions, pValues ) {
    adapter.log.debug('setStates - ' + pStateId);

    const state = pOptions;

    if (pValues) state.val = pValues.val;
    await adapter.setStateAsync(pStateId, state);

    if (adapter.config.optTypeStates){
        if (pValues) state.val = pValues.type;
        await adapter.setStateAsync(pStateId+'-type', state);
    }
    if (adapter.config.optRawStates){
        if (pValues) state.val = pValues.json;
        await adapter.setStateAsync(pStateId+'-raw', state);
    }
}

/**
 * setOnlineState - set online state for a device
 *
 * @param {object}      pCTX        device context object
 * @param {boolean}     pOnline     true if device is online, false otherwise
 * @param {string}      pMsg        (optional) text to add to info message
 * @param {string}      pErr        (optional) text to use for error message
 *                                  error message logged only if pErr != null
 * @return nothiung
 */
async function setOnlineState (pCTX, pOnline, pMsg, pErr){

    await adapter.setStateAsync(pCTX.id + '.online', {val: pOnline, ack: true, q:0x00});

    let err = 'RequestTimedOutError: Request timed out';
    if (pErr) err = pErr;
    if (pOnline) err = null;
    await adapter.setStateAsync(pCTX.id + '.last_error', {val: err, ack: true, q:0x00});

    if (pCTX.initialized && (pCTX.online == pOnline) ) return;

    if (pErr) {
        adapter.log.error(`[${pCTX.id}] ${pErr}`);
        await adapter.setStateAsync(pCTX.id + '.alarm', {val: true, ack: true, q:0x00});
    }
    if (pOnline) await adapter.setStateAsync(pCTX.id + '.alarm', {val: false, ack: true, q:0x00});

    let msg = pOnline ? 'connected' : 'disconnected';
    if (pMsg) msg = `${msg} - ${pMsg}`;
    adapter.log.info(`[${pCTX.id}] device ${msg}`);

    pCTX.initialized = true;
    pCTX.online = pOnline;
    setImmediate(handleConnectionInfo);
}

/**
 * processVarbind - process single varbind
 *
 * @param {pVarbind} snmp varbind object
 * @return string
 *
 */
async function processVarbind(pCTX, pStateId, pFormat, pWriteable, pVarbind) {
//async function processVarbind(pCTX, pChunkIdx, pIdx, pVarbind) {
    adapter.log.debug('processVarbind - [' + pCTX.id + '] ' + pStateId);

    const devId = pCTX.id;
    //const OID = pCTX.chunks[pChunkIdx].OIDs[pIdx];
    //const stateId = pCTX.chunks[pChunkIdx].ids[pIdx];
    const fullId = `${adapterName}.${adapter.instance}.${pStateId}`;

    const state = varbindDecode(pVarbind, pFormat, devId, pStateId);

    adapter.log.debug(`[${devId}] ${pStateId} (${state.typeStr})` + JSON.stringify(pVarbind));
    adapter.log.debug(`[${devId}] update ${pStateId}: ${state.val}`);

    // data OK
    await initObject({
        _id: pStateId,
        type: 'state',
        common: {
            name: devId,
            write: !!pWriteable,
            read: true,
            type: oidFormat2StateType(state.format),
            role: 'value'
        },
        native: {
        }
    });

    await setStates( pStateId,{ ack: true, q:state.qual},
        { val: state.val, type: pVarbind.type + ': '+state.typeSt, json: JSON.stringify(pVarbind) } );

    /*
    await adapter.setStateAsync(pStateId, state.val, true);
    if (adapter.config.opttypeStates){
        await adapter.setStateAsync(pStateId+'-type', pVarbind.type + ': '+state.typeStr, true);
    }
    if (adapter.config.optRawStates){
        await adapter.setStateAsync(pStateId+'-raw', JSON.stringify(pVarbind), true);
    }
    */

    if ( pWriteable ) {
        STATEs[fullId] = {
            CTX: pCTX,
            stateId: pStateId,
            format: pFormat
        };
        STATEs[fullId].varbind = {
            oid: pVarbind.oid,
            type: pVarbind.type,
            value: null
        };
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

    const devId = pCTX.id;
    const oids = pCTX.chunks[pIdx].oids;

    if (! pCTX.sessCtx){
        adapter.log.debug('[' + devId + '] session.get - session context is null, skip processing');
        return;
    }

    const result = await snmpSessionGetAsync( pCTX.sessCtx.session, oids);
    adapter.log.debug('[' + devId + '] session.get completed for chunk index ' + pIdx );
    if (result.err) {
        // error
        adapter.log.debug('[' + devId + '] session.get: ' + result.err.toString());
        if (result.err.toString() === 'RequestTimedOutError: Request timed out') {
            // timeout error
            for (let ii = 0; ii < pCTX.chunks[pIdx].ids.length; ii++) {
                await setStates( pCTX.chunks[pIdx].ids[ii], {ack: true, q:0x02} ); // connection problem
            }
            await setOnlineState( pCTX, false, 'request timeout', null); // log info only
        } else {
            // other error
            for (let ii = 0; ii < pCTX.chunks[pIdx].ids.length; ii++) {
                await setStates(pCTX.chunks[pIdx].ids[ii], {val: null, ack: true, q:0x44} ); // device reports error
            }
            await setOnlineState( pCTX, false, null, 'session.get: ' + result.err.toString()); // log an error
        }
    } else {
        // success
        await setOnlineState( pCTX, true, null, null);

        // process returned values
        for (let ii = 0; ii < result.varbinds.length; ii++) {
            if (snmp.isVarbindError(result.varbinds[ii])) {
                if ( ! pCTX.chunks[pIdx].OIDs[ii].oidOptional ||
                    ! snmp.varbindError(result.varbinds[ii]).startsWith('NoSuchInstance:') ) {
                    adapter.log.error('[' + devId + '] session.get: ' + snmp.varbindError(result.varbinds[ii]));
                }
                await setStates(pCTX.chunks[pIdx].ids[ii], {val: null, ack: true, q:0x84} ); // sensor reports error
            } else {
                const OID = pCTX.chunks[pIdx].OIDs[ii];
                const stateId = pCTX.chunks[pIdx].ids[ii];
                processVarbind(pCTX, stateId, OID.oidFormat, OID.oidWriteable, result.varbinds[ii]);
            }
        }
    }
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
    const devId = pCTX.id;

    for (let cc = 0; cc < pCTX.chunks.length; cc++) {
        adapter.log.debug('[' + devId + '] processing oid chunk index ' + cc );
        await readChunkOids( pCTX, cc);
        adapter.log.debug('[' + devId + '] processing oid chunk index ' + cc + ' completed' );
    }
}


// #################### general housekeeping functions ####################

async function handleConnectionInfo() {
    adapter.log.debug('handleConnectionInfo');

    let haveConnection = false;
    for (let ii = 0; ii < CTXs.length; ii++) {
        if (CTXs[ii].online) haveConnection = true;
    }

    if (g_isConnected !== haveConnection) {
        if (haveConnection) {
            adapter.log.info('instance connected to at least one device');
        } else {
            adapter.log.info('instance disconnected from all devices');
        }
        g_isConnected = haveConnection;

        adapter.log.debug('info.connection set to ' + g_isConnected);
    }

    await adapter.setStateAsync('info.connection', g_isConnected, true);
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

    // if ( adapter.config.optUseName ) {
    //    adapter.log.warn('Option compatibility mode has been deprecated; please consider to adapt config.');
    // }

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
        if (oid.oidName === 'online') {
            adapter.log.error('oid "' + oid.oidName + '"is invalid. Name "online" is reserved. Please correct configuration.');
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
 *		ids			array of iod id strings (index synced with oids array)
 * 		authId 	    string 	snmp community (snmp V1, V2 only)
 *		initialized	boolean	true if connection is initialized
 *		online	    boolean	true if connection to device is active
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
        CTXs[jj].initialized = false;   // connection initialization status of device
        CTXs[jj].online = false;   // connection status of device

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

    // cleanup states
    await cleanupStates();

    // read global config
    g_chunkSize = adapter.config.optChunkSize || 20;
    adapter.log.info('adapter initializing, chunk size set to ' + g_chunkSize);

    // setup worker thread contices
    setupContices();

    // init all objects
    await initAllObjects();

    adapter.log.debug('initialization completed');

    // cleanup states
    await cleanupStates();

    // start one reader thread per device
    adapter.log.debug('starting reader threads');
    for (let ii = 0; ii < CTXs.length; ii++) {
        const CTX = CTXs[ii];
        createReaderSession(CTX);
    }

    // start connection info updater
    adapter.log.debug('startconnection info updater');
    g_connUpdateTimer = adapter.setInterval(handleConnectionInfo, 15000);

    adapter.log.debug('startup completed');

}

/**
 * onStateChange - called when any state changes
 *
 * @param   {string}    pId     id of device
 * @param   {object}    pState  state object of device
 * @return
 *
 */
async function onStateChange (pFullId, pState) {
    adapter.log.debug(`onStateChange triggered - id ${pFullId}`);

    if ( ! pState || pState.ack ) return;

    adapter.log.debug(`onStateChange - state id ${pFullId} set to ${pState.val}`);

    if ( (typeof(STATEs[pFullId]) === 'undefined') || (typeof(STATEs[pFullId].varbind) === 'undefined') ) {
        adapter.log.warn(`cannot write to uninitialized state ${pFullId}`);
        return;
    }

    const CTX = STATEs[pFullId].CTX;
    const devId = CTX.id;
    const format = STATEs[pFullId].format;
    const stateId = STATEs[pFullId].stateId;

    // TODO: if state is set but no connetion is possible, errors occure every x seconds ...
    //       Read erroro trigger onStateChange with ACK-false - must be filtered somehow
    //       Set state only if something hanges (incl. quality) ???

    // prepare varbind to be written
    const varbind = varbindEncode( STATEs[pFullId], pState.val, devId, stateId );

    let sessCtx = await snmpCreateSession(CTX);

    if (varbind.value) {
        const resultSet = await snmpSessionSetAsync(sessCtx.session, [varbind]);
        if (resultSet.err) {
            adapter.log.error('[' + devId + '] session.set: ' + resultSet.err.toString());
        } else {
            adapter.log.debug('[' + devId + '] session.set: success');
        }
    }

    // reread data of device
    const resultGet = await snmpSessionGetAsync(sessCtx.session, [varbind.oid]);
    if ( resultGet.varbinds.length === 1) { /* should be always one */
        if (snmp.isVarbindError(resultGet.varbinds[0])) {
            adapter.log.error('[' + devId + '] session.get: ' + snmp.varbindError(resultGet.varbinds[0]));

            await setStates(stateId, {val: null, ack: true, q:0x84} ); // sensor reports error
            /*
            await adapter.setStateAsync(stateId, { val: null, ack: true, q: 0x84}); // sensor reports error
            if (adapter.config.optTypeStates){
                await adapter.setStateAsync(stateId+'-type', { val: null, ack: true, q: 0x84}); // sensor reports error
            }
            if (adapter.config.optRawStates){
                await adapter.setStateAsync(stateId+'-raw', {val: null, ack: true, q:0x84} ); //sensor reports error
            }
            */
        } else {
            processVarbind(CTX, stateId, format, true, resultGet.varbinds[0]);
        }
    } else {
        adapter.log.error(`[${devId}] session.set: invalid number of varbinds returned (${resultGet.varbinds.length})`);
    }

    if (sessCtx) {
        await snmpCloseSession (sessCtx);
        sessCtx=null;
    }
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
            adapter.setState(CTX.id + '.alarm', {val: false, ack: true, q:0x00});
            adapter.setState(CTX.id + '.online', {val: false, ack: true, q:0x00});
        } catch (e) { /* */ }

        // close session if one exists
        if (CTX.pollTimer) {
            try {
                adapter.clearInterval(CTX.pollTimer);
            } catch (e) { /* */ }
            CTX.pollTimer = null;
        }

        if (CTX.sessCtx) {
            snmpCloseSession(CTX.sessCtx);
            CTX.sessCtx = null;
        }
    }

    if (g_connUpdateTimer) {
        try {
            adapter.clearInterval(g_connUpdateTimer);
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
