![Logo](admin/snmp.png)
# ioBroker.snmp

![Number of Installations](http://iobroker.live/badges/snmp-installed.svg)
![Number of Installations](http://iobroker.live/badges/snmp-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.snmp.svg)](https://www.npmjs.com/package/iobroker.snmp)

![Test and Release](https://github.com/iobroker-community-adapters/iobroker.snmp/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/snmp/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.snmp.svg)](https://www.npmjs.com/package/iobroker.snmp)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.**
For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Info
This adapter can be used to poll information from devices like printers, network devices, etc. using SNMP protocol.

## Changelog
### __WORK IN PROGRESS__
* IMPORTANT: This release will change the configuration structures!
  Please backup your configuration before starting the installation.
  The Installation will try to convert the old configuration - but it is not guaranteed to succeed in all cases. 
* (McM1957) Many parts of the code have been rewriten
* (McM1957) The adapter now uses the admin5 interface
* (McM1957) Timer values can now be set differently per device (#105)
* (McM1957) Changing the order of configuration entries does no longer destroy data (#15)
* (McM1957) Stateobjects for devices can now be named. The old behavior is available as an option.

### 1.0.0 (2022-03-21)
* IMPORTANT: This release will change the object structures!
* (McM1957) latency for update of info.connection has been reduced 
* (McM1957) excessive error logging if target is unreachable hab been optimzed
* (McM1957) additional online object at ip base to indicate target is reachable has been added
* (McM1957) if OIDs specify different communities for one device a warning will be output
* (Apollon77) Sentry for crash reporting has been added

### 0.5.0
* (Marcolotti) Add documentation (de,en,ru)
* (Marcolotti) Add languages (de,en,ru)

### 0.0.3
* (Apollon77)  Fix Object Type

### 0.0.2
* (Bluefox)    Fixes

### 0.0.1
* (Bluefox)    refactoring
* (Marcolotti) initial release

## __Adapter-Configuration__
The adapter queries specified oids which are grouped within oid groups which in turn are assigned to devices. The configuration data is entered at several tabs:

### __TAB OID-Groups__
Here you specify all oids to be queried by the adapter, one oid per line.

| Parameter     | Type        | Description                       | Comment                             |
|---------------|-------------|-----------------------------------|-------------------------------------|
| active        | boolean     | if set to true, OID will be used  | can be used to disable a single OID |
| OID-Group     | text        | name of the OID group             | will used to assign group to device |
| OID-Name      | text        | name assigned to the OID          | will used to name datapoint         |
| OID           | text        | oid string (1.2.3.4.)             | oid string as specified by device vendor |
| writeable     | boolean     | should be set to true if OID is writeable | reserved for future use             |
| optional      | boolean     | should be set to true if OID is optional | reserved for future use             |

### __TAB Device__
Here you specify which devices should be queried.

| Parameter     | Type        | Description                       | Comment                             |
|---------------|-------------|-----------------------------------|-------------------------------------|
| active        | boolean     | if set to true, the device will be used  | can be used to disable a single device |
| Name          | text        | name of the device                | will be used to create name of data points |
| IP address    | text        | ip address (IPv4 or IPv6) with optional port number    | NOTE: currently only IPv4 is supported |
| OID-Group     | text        | OID group specified at tab IOD Groups | A OID group can be assigned to more than one device |                   |
| SNMP-Version  | select      | SNMP version to use               | NOTE: currently only SNMPv1 is supported     |
| Community (v1, v2c) or Auth-ID (v3) | text | community for SNMP v1 or V2c, authorization group for SNMP v3 | NOTE: currently only SNMPv1 is supported |
| timeout (sec) | number      | processing timeout in seconds     |                                     |
| retry (sec)   | number      | retry intervall in seconds        |                                     |
| polling (sec) | number      | poll intervall in seconds         |                                     |


### __TAB Authorization__
This tab contains SNMP V3 authorization information. Please note that SNMP V3 is not yet implemented.

| Parameter     | Type        | Description                       | Comment                             |
|---------------|-------------|-----------------------------------|-------------------------------------|


### __TAB Options__
Here you specify some general options

| Parameter     | Type        | Description                       | Comment                             |
|---------------|-------------|-----------------------------------|-------------------------------------|
| Compatibility mode | boolean | if this option is activeted, datapoint names are based on ip address   |

## __License__
The MIT License (MIT)

Copyright (c) 2017-2022 Marcolotti <info@ct-j.de>, ioBroker Community Developers 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
