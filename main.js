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
var adapter = utils.adapter('sma-em');

adapter.on('ready', function () {
    main();
});

adapter.on('unload', function () {
  
});


function main() {
    
	console.log("TEST")
	
}