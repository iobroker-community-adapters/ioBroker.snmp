/**
 *
 * snmp adapter, 
 *		copyright CTJaeger 2017, MIT
 *		copyright McM1957 2022, MIT
 *
 */

/*
 * description if major internal objects
 *
 *	IPs		object (hash) of IP objectes indexed by ip address
 *
 *	IP		object containing data for one device 
 *			it has the following attributes
 *		ip			string 	ip address of target device
 *		ipStr		string	ip address of target device with invalid chars removed
 *		OIDs		array of OID objects 
 *		oids		array of oid strings (used for snmp call)
 *		ids			array of id strings (index syncet o oids array)
 * 		publicCom 	string 	snmp community (snmp V1, V2 only) 
 *		initialized	boolean	true if connection is initialized 
 *		inactive	boolean	true if connection to device is active
 *		
 *	OID		object containg data for a single oid
 *			it has the following attributes
 *		ip			string 	ip address of target device
 *		ipStr		string	ip address of target device with invalid chars removed
 *		OID			string	oid (outdated use oid instead) 
 *		oid			string	oid 
 *		name		string	name of oid 
 *		id			string	id of oid (derived from name)
 *		publicCom	string 	snmp community (snmp V1, V2) - (*** deprecated ***)0
 *		write		boolean true if oid is writeable (*** not implemented ***)
 *		enabled		boolean	true if OID is enabled (Note: disabled oids are ignored during init)
 *
 */
 
/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';

/*
 * based on template created with @iobroker/create-adapter v2.1.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load modules required by adapter
const snmp = require('net-snmp');

// say hello
console.log("snmp adapter initializing ...");

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

/**
 * Start the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
	// Create the adapter and define its methods
	return adapter = utils.adapter(Object.assign({}, options, {
		name: 'snmp',

		// ready callback is called when databases are connected and adapter received configuration.
		ready: main, // Main method defined below for readability

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
}

/* *** end of initialization section *** */


// #################### global variables ####################

const IPs 		= {};		// see description at header of file
let isConnected = false; 	// local copy of info.connection state 
let connectionUpdateInterval = null;


// #################### general utility functions ####################

/**
 * Convert name to id
 *
 *		This utility routine replaces all forbidden chars and the characters '-' and any whitespace 
 *		with an underscore ('_').
 *
 * @param {string} 	name 	name of an object
 * @return {string} 		name of the object with all forbidden chars replaced
 * 
 */
function name2id(name) {
    return (name || '').replace(adapter.FORBIDDEN_CHARS, '_').replace(/[-\s]/g, '_');
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
	return (ip || '').replace(/\./g, "_");
}


// #################### object initialization functions ####################

/**
 * initObject - create or reconfigure single object
 *
 *		creates object if it does not exist
 *		overrides object data otherwise
 *		waits for action to complete using await
 *
 * @param {obj} object structure
 * @return
 *
 */
async function initObject(obj) {
	console.log('initobject '+obj._id);
	try{ 
		await adapter.setObjectAsync(obj._id, obj);
	} catch(e) {
		adapter.log.error ('error initializing obj "' + obj._id + '" ' + e.message);
	}
}

/**
 * initIpObjects - initializes all objects related to a single IP
 *
 * @param {pIP} IP object
 * @return
 *
 */
async function initIpObjects(IP) {
	console.log('initIpObjects '+IP.ip);

	const ip = IP.ip;
	const ipStr = ip2ipStr(ip);

	try{ 
		// create <ip> device object
		initObject({
					_id: ipStr,
					type: 'device',
					common: {
						name: ip
					},
					native: {
					}
				}
			);

		// create <ip>.online state object
		initObject({
					_id: ipStr + '.online',
					type: 'state',
					common: {
						name: ip + ' online',
						write: false,
						read:  true,
						type: 'boolean',
						role: 'indicator.reachable'
					},
					native: {
					}
				}
			);
	} catch(e) {
		adapter.log.error ('error creating objects for ip "' + ip + '" ' + e.message);
	}
}

/**
 * initOidObjects - initializes objects for one OID
 *
 * @param {OID} single OIDs object
 * @return
 *
 * ASSERTION: root device object is already created
 *
 */
async function initOidObjects(OID) {
	console.log('initOidObjects '+OID.name);

	const id = OID.id;
	const ip = OID.ip;
	const ipStr = OID.ipStr;

	try{ 
		// create OID folder objects
        const idArr = id.split('.');
        idArr.pop();
        let partlyId = ipStr;
        idArr.forEach( el => {
            partlyId += '.' + el;
				initObject({
						_id: partlyId,
						type: 'folder',
						common: {
							name: ''
						},
						native: {
						}
					});
		});

		// create OID state object
		initObject({
            _id: ipStr + '.' + id,
            type: 'state',
            common: {
                name:  OID.name,
                write: !!OID.write,
                read:  true,
                type: 'string',
                role: 'value'
            },
            native: {
                OID: OID.OID
            }
        });

	} catch(e) {
		adapter.log.error ('error processing oid "'+OID.OID+'" '+e.message);
	}
}



// #################### snmp session handling functions ####################


/**
 * onSessionClose - callback called whenever a session is closed
 *
 * @param {IP} IP object
 * @return
 *
 */
async function onSessionClose(IP) {
	console.log('onSessionClose (' + IP.ip + ')');
	adapter.log.debug('['+IP.ip+'] session closed');
	
	IP.session.on('error', null ); // avoid nesting callbacks
	IP.session.on('close', null ); // avoid nesting callbacks
	
	clearInterval(IP.interval);
	IP.interval = null;

	IP.session = null;

	IP.retryTimeout = setTimeout((ip, publicCom, oids, ids) => {
		IP.retryTimeout = null;
		startOneDevice(ip, publicCom, oids, ids);
		}, adapter.config.retryTimeout, ip, publicCom, oids, ids);
// ### to check parameters ###
}

/**
 * onSessionError - callback called whenever a session encounters an error
 *
 * @param {IP} 	IP object
 * @param {err} error object
 * @return
 *
 */
async function onSessionError(IP, err) {
	console.log('onSessionError (' + IP.ip + ')');
	adapter.log.debug('['+IP.ip+'] session signalled error: ' + err.toString);
	
	console.log('onSessionError (' + IP.ip + ') - error:' + err.toString);
// ### to be implemented ###
}

/**
/**
 * createSession - initializes a snmp session to one device and starts reader thread
 *
 * @param {IP} IP object
 * @return
 *
 */
async function createSession(IP) {
	console.log('createSession (' + IP.ip + ')');
	adapter.log.debug('['+IP.ip+'] creating session');
	
	// (re)set device online status
	adapter.setState(IP.ipStr + '.online', false, true);

	// close old session if one exists
    if (IP.session) {
		clearInterval(IP.interval);
		IP.interval = null;
        
		try {
			IP.session.on('error', null ); // avoid nesting callbacks
			IP.session.on('close', null ); // avoid nesting callbacks
            IP.session.close();
        } catch (e) {
            adapter.log.warn('Cannot close session for ip ' + IP.ip + ': ' + e);
        }
        IP.session = null;
    }

	// create snmp session for device
    IP.session = snmp.createSession(IP.ip, IP.publicCom, {
							timeout: adapter.config.connectTimeout
    });

    IP.session.on('close', () => { onSessionClose(IP) } );
    IP.session.on('error', (err) => { onSessionError(IP, err) } );
	IP.interval = setInterval(readOids, adapter.config.pollInterval, IP);

    // read one time immediately
	readOids(IP);

}

/**
/**
 * readOids - read all oids from a specific target device
 *
 * @param {IP} IP object
 * @return
 *
 */
function readOids(IP) {
	console.log('readOids ('+ IP.ip + ')');

	const session 	= IP.session;
	const ip 		= IP.ip;
	const ipStr 	= IP.ipStr;
	const oids		= IP.oids;
	const ids		= IP.ids;
	
    session.get(oids, (err, varbinds) => {
        if (err) {
			// error occured
            adapter.log.debug('[' + ip + '] session.get: ' + err.toString());
            if (err.toString() === 'RequestTimedOutError: Request timed out') {
				// timeout error
                if (!IP.inactive ) {
                    adapter.log.info('[' + ip + '] device disconnected - request timout');
                    IP.inactive = true;
                    setImmediate(handleConnectionInfo);
                }
            } else {
				// other error
				if (!IP.inactive) {
					adapter.log.error('[' + ip + '] session.get: ' + err.toString);
					IPs[ip].inactive = true;
					setImmediate(handleConnectionInfo);
					}
				}
            adapter.setState(ipStr + '.online', false, true);
        } else {
			// success
            if ( IP.inactive ) {
                adapter.log.info('[' + ip + '] device (re)connected');
                IP.inactive = false;
                setImmediate(handleConnectionInfo);
            }

            adapter.setState(ipStr + '.online', true, true);

			// process returned values
            for (let i = 0; i < varbinds.length; i++) {
                if (snmp.isVarbindError(varbinds[i])) {
                    adapter.log.warn(snmp.varbindError(varbinds[i]));
                    adapter.setState(ipStr + '.' +ids[i], null, true, 0x84);
                } else {
                    adapter.log.debug('[' + ip + '] update ' + ip.replace(/\./g, "_") + '.' +ids[i]);
                    adapter.setState(ipStr + '.' +ids[i], varbinds[i].value.toString(), true);
                }
            }
        }

        if ( !IP.initialized ) {
            IP.initialized = true;
            setImmediate(handleConnectionInfo);
        }
    });
}

// #################### general housekeeping functions ####################

function handleConnectionInfo() {
	console.log('handleConnectionInfo');
	
    let haveConnection = false;
    for (let ip in IPs) {
		if (!IPs[ip].inactive)  {
            haveConnection = true;
		}
	}
	
	if (isConnected !== haveConnection)  {
		if (haveConnection) {
			adapter.log.info('instance connected to at least one device');
		} else {
			adapter.log.info('instance disconnected from all devices');
		}
		isConnected = haveConnection;

		adapter.log.debug('info.connection set to '+ isConnected);
		adapter.setState('info.connection', isConnected, true);
	}
}


// #################### adapter main functions ####################

/**
 * main - will be called as soon as adapter is ready
 *
 * @param
 * @return
 *
 */
async function main() {

	// mark adapter as non active
	await adapter.setState('info.connection', false, true);

	// get and verify configuration
    if (!adapter.config.OIDs) {
        adapter.log.error('No OIDs configured, nothing to do');
        return;
    }

    adapter.config.retryTimeout   = parseInt(adapter.config.retryTimeout,   10) || 5000;
    adapter.config.connectTimeout = parseInt(adapter.config.connectTimeout, 10) || 5000;
    adapter.config.pollInterval   = parseInt(adapter.config.pollInterval,   10) || 30000;

    if (adapter.config.pollInterval < 5000) { adapter.config.pollInterval = 5000; };
	
    for (let i = 0; i < adapter.config.OIDs.length; i++) {
		if (!adapter.config.OIDs[i].ip) {
			adapter.config.OIDs[i].enabled = false;
        } else {
			adapter.config.OIDs[i].ip = adapter.config.OIDs[i].ip.trim();
		}
	}
	
	// setup IP / OID table
    for (let i = 0; i < adapter.config.OIDs.length; i++) {

        if (!adapter.config.OIDs[i].enabled) { continue; };

		const OID 	= adapter.config.OIDs[i];
		OID.oid 	= OID.OID; 	// covert historical paramater name to lower case
		OID.id		= name2id(OID.name);
        const ip 	= OID.ip;
		OID.ipStr 	= ip2ipStr(ip);
		const publicCom = adapter.config.OIDs[i].publicCom;

		// register ip (if not yet done)
        IPs[ip] = IPs[ip] || {
			ip		: ip,
			ipStr	: ip2ipStr(ip),
			OIDs	: [], 
			oids	: [],
			ids		: [],
			publicCom: publicCom, 
			initialized: false, 
			inactive: false
			};

		// add new OID object and oid infos for net-snmp
        IPs[ip].OIDs.push(OID);
        IPs[ip].oids.push(OID.oid.trim().replace(/^\./, ''));
        IPs[ip].ids.push(OID.id);

		// verify that all OIDs specify identical community for same device (same ip)
		if ( IPs[ip].publicCom !== publicCom ) {
			adapter.log.warn('[' + ip + '] OID ' + oid + ' specifies different community "' + publicCom + '"');
			adapter.log.warn('[' + ip + '] value will be ignored, keeping current value "' + IPs[ip].publicCom + '"');
		}
	}

	// init objects
    for (const ip in IPs) { 
		adapter.log.debug('handling device with ip ' + ip);
		
		const IP = IPs[ip];
	
		// create IP objects
		initIpObjects(IP);

		// create OID objects
		IP.OIDs.forEach( OID => {
			adapter.log.debug('handling oid '+ OID.OID +' for ip ' + ip);
			initOidObjects(OID);
		});		
	}

	console.log('initialization completed');

	// start one reader therad per device (per IP)
	console.log('starting reader threads');
    for (const ip in IPs) { 
		const IP = IPs[ip];
		console.log('processin device with ip ' + IP.ip);
		createSession(IP);
	}
	
	// start connection info updater
	console.log('startconnection info updater');
    connectionUpdateInterval = setInterval(handleConnectionInfo, 15000)

}

/**
 * onUnload - called when adapter shuts down
 *
 * @param {callback} callback 	callback function
 * @return
 *
 */
function onUnload(callback) {
	for (let ip in IPs) {
		if (IPs.hasOwnProperty(ip) && IPs[ip].session) {
			try {
				IPs[ip].session.close();
				adapter.setState(ip.replace(/\./g, "_") + '.online', false, true);
			} catch (e) {
				// Ignore
			}
			IPs[ip].session = null;
			IPs[ip].interval && clearInterval(IPs[ip].interval);
			IPs[ip].retryTimeout && clearTimeout(IPs[ip].retryTimeout);
		}
	}

    try {
		if (connectionUpdateInterval) {
			clearInterval(connectionUpdateInterval);
			connectionUpdateInterval = null;
		}
    } catch(e) {
        // Ignore
    }

    try {
        adapter.setState('info.connection', false, true);
    } catch(e) {
        // Ignore
    }

	// callback must be called under all circumstances
    callback && callback();
}



/**
 * here we start
 */
if (require.main !== module) {
	// Export startAdapter in compact mode
	module.exports = startAdapter;
} else {
	// otherwise start the instance directly
	startAdapter();
}
