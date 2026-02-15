![Logo](admin/snmp.png)
# ioBroker.snmp

[![GitHub license](https://img.shields.io/github/license/iobroker-community-adapters/ioBroker.snmp)](https://github.com/iobroker-community-adapters/ioBroker.snmp/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/iobroker.snmp.svg)](https://www.npmjs.com/package/iobroker.snmp)
![GitHub repo size](https://img.shields.io/github/repo-size/iobroker-community-adapters/ioBroker.snmp)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/snmp/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)</br>
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/iobroker-community-adapters/ioBroker.snmp)
![GitHub commits since latest release (by date)](https://img.shields.io/github/commits-since/iobroker-community-adapters/ioBroker.snmp/latest)
![GitHub last commit](https://img.shields.io/github/last-commit/iobroker-community-adapters/ioBroker.snmp)
![GitHub issues](https://img.shields.io/github/issues/iobroker-community-adapters/ioBroker.snmp)
</br>
**Version:** </br>
[![NPM version](http://img.shields.io/npm/v/iobroker.snmp.svg)](https://www.npmjs.com/package/iobroker.snmp)
![Current version in stable repository](https://iobroker.live/badges/snmp-stable.svg)
![Number of Installations](https://iobroker.live/badges/snmp-installed.svg)
</br>
**Tests:** </br>
[![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.snmp/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/iobroker-community-adapters/ioBroker.snmp/actions/workflows/test-and-release.yml)
[![CodeQL](https://github.com/iobroker-community-adapters/ioBroker.snmp/actions/workflows/codeql.yml/badge.svg)](https://github.com/iobroker-community-adapters/ioBroker.snmp/actions/workflows/codeql.yml)

## Sentry
**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.**
For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Info
This adapter can be used to poll information from devices like printers, network devices, etc. using SNMP protocol.

## Adapter-Configuration
The adapter queries specified OIDs which are grouped within oid groups which in turn are assigned to devices.
The configuration data is entered at several tabs. The adapter supports IPv4 adn IPv6 connections.

For details see documentation referenced below.

## Documentation

[english documentation](docs/en/snmp.md)<br>
[deutsche Dokumentation](docs/de/snmp.md)<br>
[russian documentation](docs/ru/snmp.md)

## Changelog

<!--
   ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
- (mcm1957) Dependencies have been updated

### 3.3.0 (2025-08-17)
* (mcm1957) Adapter requires node.js 20, js-controller >= 6.0.11 and admin >= 7.6.17 now.
* (mcm1957) Dependencies have been updated

### 3.2.0 (2024-03-29)
* (mcm1957) Adapter requires node.js 18 and js-controller >= 5 now
* (mcm1957) Dependencies have been updated

### 3.1.0 (2023-10-13)
* (mcm1957) Requirements have been updated. Adapter requires node.js 18 or newer now
* (mcm1957) Packages have been update to cleanup open dependabot PRs

### 3.0.0 (2023-10-12)
* (bluefox) updated packages. Minimal node.js version is 16

### 2.4.11 (2023-07-13)
* (McM1957) Node-net-snmp has been updated to improve uint32 handling (#282)
* (McM1957) Several other dependencies have been updated

## License
The MIT License (MIT)

Copyright (c) 2024-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2017-2023 Marcolotti <info@ct-j.de>, McM1957 <mcm57@gmx.at>, ioBroker Community Developers 

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
