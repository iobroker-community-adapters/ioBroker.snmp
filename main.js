/**
 *
 * snmp-oid adapter, Copyright CTJaeger 2017, MIT
 *
 */

/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var snmp = require('net-snmp');
var adapter = utils.adapter('snmp-oid');

adapter.on('ready', function () {
    main();
});

adapter.on('unload', function () {
  
});


function main() {
readsnmp()
	
}

function readsnmp(){
	var session = snmp.createSession (adapter.config.SNMPIP, "public");
    adapter.log.info('Name ' + adapter.config.NAME + ' OID:' + adapter.config.OID);

	var oids = ["1.3.6.1.2.1.43.11.1.1.9.1.1"];



session.get (oids, function (error, varbinds) {
    if (error) {
        adapter.log.info('Fehler: '+error);
    } else {
        for (var i = 0; i < varbinds.length; i++)
            if (snmp.isVarbindError (varbinds[i]))
                adapter.log.info (snmp.varbindError (varbinds[i]));
            else
               // console.log (varbinds[i].oid + " = " + varbinds[i].value);
		       
		   
			adapter.setState(adapter.config.NAME, varbinds[i].value, true);
			adapter.log.info('Name ' + adapter.config.NAME + ': Ergebnis: ' + varbinds[i].value);
    }
});

session.trap (snmp.TrapType.LinkDown, function (error) {
    if (error)
        console.error (error);
});
	console.log("TEST")
	
}