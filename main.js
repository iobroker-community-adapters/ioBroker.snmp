/**
 *
 * snmp adapter, Copyright CTJaeger 2017, MIT
 *
 */

/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const snmp = require('net-snmp');

const adapter = new utils.Adapter('snmp');
const IPs = {};

let connected = false;
let connectionUpdateInterval = null;

// startup
adapter.on('ready', main);

// shutdown - close all opened sockets
adapter.on('unload', (callback) => {
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

	if (connectionUpdateInterval) {
		clearInterval(connectionUpdateInterval);
		connectionUpdateInterval = null;
	}

    try {
        adapter.setState('info.connection', false, true);
    } catch {
        // Ignore
    }

    callback && callback();
});

function name2id(name) {
    return (name || '').replace(adapter.FORBIDDEN_CHARS, '_');
}

function processTasks(tasks, callback) {
    if (!tasks || !tasks.length) {
        callback && callback();
    } else {
        const task = tasks.shift();
        adapter.getObject(task._id, (err, obj) => {
            if (!obj) {
                adapter.setObject(task._id, task, (err) => {
                    setImmediate(processTasks, tasks, callback);
                });
            } else {
                if (task.native.OID !== obj.native.OID || obj.common.write !== task.common.write) {
                    obj.native = task.native;
                    obj.common.write = task.common.write;
                    adapter.extendObject(obj._id, obj, (err) => {
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
        adapter.log.error('No OIDs configured, nothing to do');
        return;
    }

    adapter.config.retryTimeout   = parseInt(adapter.config.retryTimeout,   10) || 5000;
    adapter.config.connectTimeout = parseInt(adapter.config.connectTimeout, 10) || 5000;
    adapter.config.pollInterval   = parseInt(adapter.config.pollInterval,   10) || 30000;
    if (adapter.config.pollInterval < 5000) {
        adapter.config.pollInterval = 5000;
    }

	adapter.setState('info.connection', false, true);

    const tasks = [];
    for (let i = 0; i < adapter.config.OIDs.length; i++) {
        if (!adapter.config.OIDs[i].ip || !adapter.config.OIDs[i].enabled) {
            continue;
        }

        const ip = adapter.config.OIDs[i].ip.trim();
        const id = name2id(adapter.config.OIDs[i].name);

        IPs[ip] = IPs[ip] || {oids: [], ids: [], publicCom: adapter.config.OIDs[i].publicCom};

        IPs[ip].oids.push(adapter.config.OIDs[i].OID.trim().replace(/^\./, ''));
        IPs[ip].ids.push(id);
		IPs[ip].initialized = false;
		IPs[ip].inactive = false;

		// verify that all OIDs specify identical community for same device (same ip)
		if ( IPs[ip].publicCom !== adapter.config.OIDs[i].publicCom ) {
			adapter.log.warn('[' + ip + '] OID ' + adapter.config.OIDs[i].OID.trim().replace(/^\./, '') +
				' specifies different community "' + adapter.config.OIDs[i].publicCom + '"');
			adapter.log.warn('[' + ip + '] value will be ignored, keeping current value "' + IPs[ip].publicCom + '"');
		}

        const IPString = ip.replace(/\./g, "_");

        tasks.push({
            _id: IPString,
            type: 'device',
            common: {
                name: ip
            },
            native: {
                OID: adapter.config.OIDs[i].OID
            }
        });

		tasks.push({
            _id: IPString + '.online',
            type: 'state',
            common: {
                name: ip + ' online',
                write: false,
                read:  true,
                type: 'boolean',
                role: 'indicator.reachable'
            },
            native: {
                OID: adapter.config.OIDs[i].OID
            }
        });

        const idArr = id.split('.');
        idArr.pop();
        let partlyId = IPString;
        idArr.forEach( el => {
            partlyId += '.' + el;
            tasks.push({
                _id: partlyId,
                type: 'folder',
                common: {
                    name: ''
                },
                native: {
                }
            });
        });

		tasks.push({
            _id: IPString + '.' + id,
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

    connectionUpdateInterval = setInterval(handleConnectionInfo, 15000);
}

function handleConnectionInfo() {
    let isConnected = false;

    adapter.log.debug('executing handleConnectionInfo');

    for (let ip in IPs) {
		if (! IPs[ip].inactive)  {
            isConnected = true;
		}
	}
	adapter.log.debug('info.connection set to '+ isConnected);
	adapter.setState('info.connection', isConnected, true);
	if (isConnected)  {
		if (!connected) {
			adapter.log.info('instance connected to at least one device');
            connected = true;
		}
	} else  {
		if (connected) {
			adapter.log.info('instance disconnected from all devices');
            connected = false;
		}
	}
}

function readOids(session, ip, oids, ids) {
	adapter.log.debug('[' + ip + '] executing readOids');

    session.get(oids, (error, varbinds) => {
        if (error) {
            adapter.log.debug('[' + ip + '] session.get: ' + error);
            if (error === 'RequestTimedOutError: Request timed out') {
                if ( ! IPs[ip].inactive ) {
                    adapter.log.info('[' + ip + '] device disconnected - request timout');
                    IPs[ip].inactive = true;
                    setImmediate(handleConnectionInfo);
                }
            } else {
                if ( ! IPs[ip].inactive ) {
                    adapter.log.error('[' + ip + '] session.get: ' +error);
                    IPs[ip].inactive = true;
                    setImmediate(handleConnectionInfo);
                }
                adapter.setState(ip.replace(/\./g, "_") + '.online', false, true);
            }
        } else {
            if ( IPs[ip].inactive ) {
                adapter.log.info('[' + ip + '] device (re)connected');
                IPs[ip].inactive = false;
                setImmediate(handleConnectionInfo);
            }

            adapter.setState(ip.replace(/\./g, "_") + '.online', true, true);

            for (let i = 0; i < varbinds.length; i++) {
                if (snmp.isVarbindError(varbinds[i])) {
                    adapter.log.warn(snmp.varbindError(varbinds[i]));
                    adapter.setState(ip.replace(/\./g, "_") + '.' +ids[i], null, true, 0x84);
                } else {
                    adapter.log.debug('[' + ip + '] update ' + ip.replace(/\./g, "_") + '.' +ids[i]);
                    adapter.setState(ip.replace(/\./g, "_") + '.' +ids[i], varbinds[i].value.toString(), true);
                    // adapter.setState('info.connection', true, true);
                }
            }
        }

        if ( ! IPs[ip].initialized ) {
            IPs[ip].initialized = true;
            setImmediate(handleConnectionInfo);
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

	// initialize connection status
	adapter.setState(ip.replace(/\./g, "_") + '.online', false, true);

	// create snmp session for device
    IPs[ip].session = snmp.createSession(ip, publicCom || 'public', {
        timeout: adapter.config.connectTimeout
    });
    adapter.log.debug('[' + ip + '] OIDs: ' + oids.join(', '));

    IPs[ip].interval = setInterval(readOids, adapter.config.pollInterval, IPs[ip].session, ip, oids, ids);

    IPs[ip].session.on('close', function () {
        IPs[ip].session = null;
        clearInterval(IPs[ip].interval);
        IPs[ip].interval = null;
        IPs[ip].retryTimeout = setTimeout((ip, publicCom, oids, ids) => {
            IPs[ip].retryTimeout = null;
            readOneDevice(ip, publicCom, oids, ids);
        }, adapter.config.retryTimeout, ip, publicCom, oids, ids);
    });

    // read one time immediately
    readOids(IPs[ip].session, ip, oids, ids);

}

function readAll() {
	adapter.log.debug('executing readAll');
    for (let ip in IPs) {
        if (IPs.hasOwnProperty(ip))  {
            readOneDevice(ip, IPs[ip].publicCom, IPs[ip].oids, IPs[ip].ids);
        }
    }
}
