/**
 *
 * snmp adapter, Copyright CTJaeger 2017, MIT
 *
 * changelog:
 *
 * 2022-02-18 	McM1957	 0.6.0
 *		add info.connection state per ip 
 *		avoid excessive errors if target is unreachable
 *		improve setting of state info.connection
 *		output warning if OIDs specify different commmunities for one device
 *
 * 2022-03-05 	McM1957	 0.6.1
 *		reduce timout warning to info level
 *		reduce latency for update of info.connection
 *
 */

/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils = require('@iobroker/adapter-core'); // Get common adapter utils
var snmp    = require('net-snmp');

var adapter = new utils.Adapter('snmp');
var IPs = {};
var myData = {};

myData.connected = false;

// startup 
adapter.on('ready', main);

// shutdown - close all opened sockets
adapter.on('unload', function (callback) {
    for (var ip in IPs) {
        if (IPs.hasOwnProperty(ip) && IPs[ip].session) {
            try {
                IPs[ip].session.close();
            } catch (e) {

            }
            IPs[ip].session = null;
        }
    }
	
	if (myData.interval) {
		try {
			clearInterval(myData.interval);
		} catch (e) {

		}
		myData.interval = null;
	}
	
    callback && callback();
});

function name2id(name) {
    return (name || '').replace(/[-\s.]+/, '_');
}
function processTasks(tasks, callback) {
    if (!tasks || !tasks.length) {
        callback && callback();
    } else {
        var task = tasks.shift();
        adapter.getForeignObject(task._id, function (err, obj) {
            if (!obj) {
                adapter.setForeignObject(task._id, task, function (err) {
                    setImmediate(processTasks, tasks, callback);
                });
            } else {
                if (task.native.OID !== obj.native.OID || obj.common.write !== task.common.write) {
                    obj.native = task.native;
                    obj.common.write = task.common.write;
                    adapter.setForeignObject(obj._id, obj, function (err) {
                        setImmediate(processTasks, tasks, callback);
                    });
                } else {
                    setImmediate(processTasks, tasks, callback);
                }
            }
        });
    }
}

function main() {
    if (!adapter.config.OIDs) {
        adapter.log.error('No OIDs found');
        return;
    }

    adapter.config.retryTimeout   = parseInt(adapter.config.retryTimeout,   10) || 5000;
    adapter.config.connectTimeout = parseInt(adapter.config.connectTimeout, 10) || 5000;
    adapter.config.pollInterval   = parseInt(adapter.config.pollInterval,   10) || 30000;
    if (adapter.config.pollInterval < 5000) {
        adapter.config.pollInterval = 5000;
    }

	adapter.setState('info.connection', false, true);

    var tasks = [];
    for (var i = 0; i < adapter.config.OIDs.length; i++) {
        if (!adapter.config.OIDs[i].ip || !adapter.config.OIDs[i].enabled) {
            continue;
        }

        var ip = adapter.config.OIDs[i].ip.trim();
        var id = name2id(adapter.config.OIDs[i].name);

        IPs[ip] = IPs[ip] || {oids: [], ids: [], publicCom: adapter.config.OIDs[i].publicCom};

        IPs[ip].oids.push(adapter.config.OIDs[i].OID.trim().replace(/^\./, ''));
        IPs[ip].ids.push(id);
		IPs[ip].inactive = true;

		// verify that all OIDs specifiy identical community for same device (same ip)
		if ( IPs[ip].publicCom != adapter.config.OIDs[i].publicCom ) {
			adapter.log.warn('[' + ip + '] OID ' + adapter.config.OIDs[i].OID.trim().replace(/^\./, '') + 
				' specifies different community "' + adapter.config.OIDs[i].publicCom + '"');
			adapter.log.warn('[' + ip + '] value will be ignored, keeping current value "' + IPs[ip].publicCom + '"');
		}

        var IPString = ip.replace(/\./gi, "_");

        tasks.push({
            _id: adapter.namespace + '.' + IPString,
            type: 'channel',
            common: {
                //name:  adapter.config.OIDs[i].name,
                //write: !!adapter.config.OIDs[i].write,
                read:  true,
                role: 'value'
            },
            native: {
                OID: adapter.config.OIDs[i].OID
            }
        });
		
        tasks.push({
            _id: adapter.namespace + '.' + IPString + '.info',
            type: 'channel',
            common: {
                name:  'device information',
                //write: !!adapter.config.OIDs[i].write,
                read:  true,
                role: 'value'
            },
            native: {
                OID: adapter.config.OIDs[i].OID
            }
        });
		
		tasks.push({
            _id: adapter.namespace + '.' + IPString + '.info.connection',
            type: 'state',
            common: {
                name:  'If device is connected',
                //write: !!adapter.config.OIDs[i].write,
                read:  true,
                type: 'boolean',
                role: 'value'
            },
            native: {
                OID: adapter.config.OIDs[i].OID
            }
        });

		tasks.push({
            _id: adapter.namespace + '.' + IPString + '.' + id,
            type: 'state',
            common: {
                name:  adapter.config.OIDs[i].name,
                write: !!adapter.config.OIDs[i].write,
                read:  true,
                type: 'string',
                role: 'value'
            },
            native: {
                OID: adapter.config.OIDs[i].OID
            }
        });
    }
    processTasks(tasks, readAll);
	
    myData.interval = setInterval(handleConnectionInfo, 15000);
}

function handleConnectionInfo() {
	var connected = false;

	adapter.log.debug('executing handleConnectionInfo');
	
    for (var ip in IPs) {
		if (! IPs[ip].inactive)  {
			connected = true;
		}
	}
	adapter.setState('info.connection', connected, true);
	if ( connected ) {
		if ( ! myData.connected ) {
			adapter.log.info('instance connected to at least one device');
			myData.connected = true;
		}
	} else  {
		if ( myData.connected ) {
			adapter.log.info('instance disconnected from all devices');
			myData.connected = false;
		}
	}
}

function readOids(session, ip, oids, ids) {
	adapter.log.debug('[' + ip + '] executing readOids');

    session.get(oids, function (error, varbinds) {
            if (error) {
				adapter.log.debug('[' + ip + '] session.get: ' + error);
				if (error == 'RequestTimedOutError: Request timed out') {
					if ( ! IPs[ip].inactive ) {
						adapter.log.info('[' + ip + '] device disconnected - request timout');
						IPs[ip].inactive = true;
						setImmediate(handleConnectionInfo);
					};
				} else {
					if ( ! IPs[ip].inactive ) {
						adapter.log.error('[' + ip + '] session.get: ' +error);
						IPs[ip].inactive = true;
						setImmediate(handleConnectionInfo);
					};
					adapter.setState(ip.replace(/\./gi, "_") + '.info.connection', false, true);
				}
            } else {
				if ( IPs[ip].inactive ) {
					adapter.log.info('[' + ip + '] device (re)connected');
					IPs[ip].inactive = false;
					setImmediate(handleConnectionInfo);
				};
				
				adapter.setState(ip.replace(/\./gi, "_") + '.info.connection', true, true);
                
				for (var i = 0; i < varbinds.length; i++) {
					if (snmp.isVarbindError(varbinds[i])) {
                        adapter.log.warn(snmp.varbindError(varbinds[i]));
                        adapter.setState(ip.replace(/\./gi, "_") + '.' +ids[i], null, true, 0x84);
                    } else {
						adapter.log.debug('[' + ip + '] update ' + ip.replace(/\./gi, "_") + '.' +ids[i]);
                        adapter.setState(ip.replace(/\./gi, "_") + '.' +ids[i], varbinds[i].value.toString(), true);
                        // adapter.setState('info.connection', true, true); 
                    }
                }
            }
        });
}

function readOneDevice(ip, publicCom, oids, ids) {
	adapter.log.debug('executing readOneDevice (' + ip + ', ...)');
    if (IPs[ip].session) {
        try {
            IPs[ip].session.close();
//            adapter.setState('info.connection', false, true);
        } catch (e) {
            adapter.log.warn('Cannot close session: ' + e);
        }
        IPs[ip].session = null;
    }

    IPs[ip].session = snmp.createSession(ip, publicCom || 'public', {
        timeout: adapter.config.connectTimeout
    });
    adapter.log.debug('[' + ip + '] OIDs: ' + oids.join(', '));

    IPs[ip].interval = setInterval(readOids, adapter.config.pollInterval, IPs[ip].session, ip, oids, ids);

    IPs[ip].session.on('close', function () {
        IPs[ip].session = null;
        clearInterval(IPs[ip].interval);
        IPs[ip].interval = null;
        setTimeout(readOneDevice, adapter.config.retryTimeout, ip, publicCom, oids, ids);
    });

    // read one time immediately
    readOids(IPs[ip].session, ip, oids, ids);
}

function readAll() {
	adapter.log.debug('executing readAll');
    for (var ip in IPs) {
        if (IPs.hasOwnProperty(ip))  {
            readOneDevice(ip, IPs[ip].publicCom, IPs[ip].oids, IPs[ip].ids);
        }
    }
}
