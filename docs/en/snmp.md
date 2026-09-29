# SNMP adapter information

## General information
Simple Network Management Protocol (SNMP) is an Internet Standard protocol for collecting and organizing information about 
managed devices on IP networks and for modifying that information to change device behaviour. Devices that typically support 
SNMP include cable modems, routers, switches, servers, workstations, printers, and more.

SNMP is widely used in network management for network monitoring. SNMP exposes management data in the form of variables 
on the managed systems organized in a management information base (MIB) which describe the system status and configuration. 
These variables can then be remotely queried (and, in some circumstances, manipulated) by managing applications.

Three significant versions of SNMP have been developed and deployed. SNMPv1 is the original version of the protocol. 
More recent versions, SNMPv2c and SNMPv3, feature improvements in performance, flexibility and security.
(Text taken from Wikipedia, the free encyclopedia)

The SNMP adapter uses the so-called OID's (Object Identifier) to read these values from the configured device.

## Configuration
The adapter queries specified OIDs (object identifiers) which are grouped within oid groups which in turn are assigned to devices. The 
configuration data is entered at several tabs, in the order in which they appear: first the devices, then the OIDs they read. A device
whose OID group does not exist yet can be saved - the adapter warns about it and skips that device until its OIDs have been defined.

### TAB OID-Groups
Here you specify all OIDs to be queried by the adapter, one oid per line.

<p align="center"><img src="img/snmp_tab_oids.jpg" width="600" /></p>

| Parameter     | Type       | Description                               | Comment                                                                                               |
|---------------|------------|-------------------------------------------|-------------------------------------------------------------------------------------------------------|
| active        | boolean    | if set to true, OID will be used          | can be used to disable a single OID                                                                   |
| OID-Group     | text       | name of the OID group                     | will used to assign group to device                                                                   |
| OID-Name      | text       | name assigned to the OID                  | will used to name datapoint                                                                           |
| OID           | text       | oid string (1.2.3.4.)                     | oid string as specified by device vendor                                                              |
| Format        | select     | how the value is stored                   | String, Number, Boolean, JSON or Automatic - see *Format and state type* below                        |
| writeable     | boolean    | should be set to true if OID is writeable | the state is created writeable and written back to the device, see *Writing* below                    |
| optional      | boolean    | should be set to true if OID is optional  | if set to true, no error will be raised if oid is unknown (Functionality not avaialable with snmp V1) |


You can simply activate/deactivate any oid by setting the active flag. Note that the ID of the ioBroker state to store the read data is 
normally constructed by combining the device name (see tab devices) and the OID-name specified here. You can use dots within the OID-name 
to construct a folder structure.

If some OIDs are not always available, consider setting the optional flag to avoid unnecessary errors. Please note that this 
requires the use of snmp v2c or SNMPv3 protocol versions.

#### Format and state type

The format decides how the value read is stored, and with it the type of the ioBroker state:

| Format    | state type | value                                                                                        |
|-----------|------------|----------------------------------------------------------------------------------------------|
| String    | string     | the value as text                                                                              |
| Number    | number     | the numeric value; data that is not numeric sets the quality to 0x01                          |
| Boolean   | boolean    | false for 0 resp. an empty value, true otherwise                                               |
| JSON      | string     | `{"type":"<type>","data":<value>}`, so that scripts get the value together with its type       |
| Automatic | mixed      | the type follows the SNMP type of the value                                                    |

With **Automatic** an integer type (Integer32, Counter32, Gauge32, TimeTicks, Counter64, …) becomes
a number, Boolean becomes a boolean and everything else (OctetString, OID, IpAddress, Opaque) a
string. The state is created as `mixed`, because the device decides what arrives. Choose one of the
fixed formats if a script or a chart needs a stable type.
 
### TAB Devices
Here you specify which devices should be queried.

The button **Set up device** opens a wizard which walks through the three steps a new device needs:
the device itself (name, address, SNMP version, community), its MIB files - which are optional and
can be uploaded right there - and the values it should read. The last step reads the device live,
even though it has not been saved yet, so you can tick the values you actually get. The wizard
writes the device and its OIDs into the tables of this dialog; saving stays with the save button.

The button **Set up device** opens a wizard which walks through the three steps a new device needs:
the device itself (name, address, SNMP version, community), its MIB files - which are optional and
can be uploaded right there - and the values it should read. The last step reads the device live,
even though it has not been saved yet, so you can tick the values you actually get. The wizard
writes the device and its OIDs into the tables of this dialog; saving stays with the save button.

<p align="center"><img src="img/snmp_tab_devices.jpg" width="600" /></p>

| Parameter                             | Type    | Description                                                       | Comment                                                                                                                                               |
|---------------------------------------|---------|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| active                                | boolean | if set to true, the device will be used                           | can be used to disable a single device                                                                                                                |
| Name                                  | text    | name of the device                                                | will be used to create name of data points                                                                                                            |
| IP address                            | text    | ip address (IPv4 or IPv6) or domainname with optional port number | IPv4 1.2.3.4 or 1.2.3.4:161, IPv6 2001:abcd::30ff, IPv6 [2001:abcd::30ff] or [2001:abcd::30ff]:161, Domain myhost.domain.org or myhost.domain.org:161 |
| IPv6                                  | boolean | if set IPv6 should be used                                        |                                                                                                                                                       |
| OID-Group                             | text    | OID group specified at tab IOD Groups                             | A OID group can be assigned to more than one device                                                                                                   |                   |
| SNMP-Version                          | select  | SNMP version to use                                               |                                                                                                                                                       |
| Community (v1, v2c) or Auth-ID (v3)   | text    | community for SNMP v1 or V2c, authorization group for SNMP v3     |                                                                                                                                                       |
| timeout (sec)                         | number  | processing timeout in seconds                                     |                                                                                                                                                       |
| retry (sec)                           | number  | retry intervall in seconds                                        |                                                                                                                                                       |
| polling (sec)                         | number  | poll intervall in seconds                                         |                                                                                                                                                       |


### TAB Authorization
This tab contains SNMP V3 authorization information. 

<p align=center><img src="img/snmp_tab_authorization.jpg" width="600" /></p>

| Parameter         | Type        | Description                       | Comment                             |
|-------------------|-------------|-----------------------------------|-------------------------------------|
| Name (id)         | text        | id of authorization data          | must match Auth-Id at tab devices   |
| Security Level    | selection   | desired security method           | see description                     |
| Username          | text        | username to authenticate          |                                     |
| Method            | selection   | password hashing method           | md5, sha, sha224, sha256, sha384 or sha512 |
| Authorization Key | text        | password for authentication       |                                     |
| Encryption        | selection   | encryption method                 | des, aes, aes256b or aes256r        |
| Encryption Key    | text        | encryption key                    |                                     |

Note that Name(id) must be unique.

When selection snmp V3 protocol, an extended authentication is required. At the devices you specify the name of an authentication block
at column Auth-Id. At this tab you must select the desired security level as follows:
* minimum - only a username is required
* authentication - username and password are required
* authentication and encryption - username, password and encryption key are required.

Please note that the specified security level must be supported by the target device and username, password and encryption key must match 
the data entered at the target device. You can use the same authorization block for multiple devices as long as they use the same data.

### TAB MIB
Here you upload the MIB files of your devices and browse their contents.

| Parameter | Type | Description                       | Comment                                                                     |
|-----------|------|-----------------------------------|-----------------------------------------------------------------------------|
| MIB files | file | MIB files of your devices         | all uploaded files are kept in one folder, so a MIB may IMPORT another one  |

The MIBs shipped with the adapter (SNMPv2-MIB, RFC1213-MIB, IF-MIB and the other SMI base modules)
are always available and do not have to be uploaded.

Below the upload the **MIB browser** shows the device itself. At the top you choose the **device**
the OIDs are collected for - its OID group is filled in automatically, so you normally never have to
type a group name.

The tree below is always the device, read live and one level at a time: the start OID gives the
first level, opening a folder reads what is inside it. So only what you actually look at is read,
and what you see are the values that really exist. The uploaded MIB files give those values their
names - `1.3.6.1.4.1.48690.10.2.1.2.1` becomes `pName.1`, with syntax, access rights and the
DESCRIPTION text as a tooltip. An OID no MIB covers keeps its numbers. The **MIB module** list jumps
to the beginning of a MIB, so you do not have to know its OID; the start OID can also be typed.

This requires a running instance, and the device must have been saved once - a device that only
exists in the dialog cannot be read yet. In the setup wizard on the *Devices* tab it can, because
there the whole device is sent along with the request.

A value read from a table row brings its index, so it is taken over as it is. A column itself does
not address a value - it is marked, and opening it shows the rows to pick from. A scalar is taken
over as `<OID>.0`, which is where SNMP keeps its only value, and the `.0` is left out of the
object id again.

The plus button of a row adds that OID to the OID group shown above, **Add all** adds everything the
filter currently shows, and the button of a folder adds every value below that node - the whole
table with one click. An OID the group already contains is marked with a check mark instead of the
plus, so it cannot be added twice. The OID name is taken from the MIB, the format is set to
*automatic* and *writeable* is taken over from the MAX-ACCESS clause of the MIB.

So the usual procedure for a new device is: create the device with its IP address on the *Devices*
tab, upload its MIB here if you have one, then select the device in the MIB browser and pick the
values you want - or enter the OIDs by hand on the *OID groups* tab. Until the OID group of a device
contains at least one active OID, the adapter skips that device with a warning and keeps running, so
that the MIB browser can still read the MIB files and the device itself.

### TAB Options
Here you specify some general options

<p align=center><img src="img/snmp_tab_options.jpg" width="600" /></p>

| Parameter          | Type      | Description                                                            | Comment                                                                                                                     |
|--------------------|-----------|------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Packetsize         | integer   | maximum number of OIDs sent within a single request                    | reduce this value in case of TOOBIG errors                                                                                  |
| Compatibility mode | boolean   | if this option is activated, datapoint names are based on ip address   | NOTE: outdated - do not use any longer. This flag will not work with IPv6 addresses. Might be removed in future releases.   |
| Keep session       | boolean   | do not close and reopen the reader session of a device on an error     | try this if a device does not answer any more after a single failed request                                                 |
| Use MIB names      | boolean   | OID field accepts symbolic MIB names and the object ids follow the MIB | see below. NOTE: switching this option changes the object ids of existing OIDs                                              |
| Raw states         | boolean   | create an additional state `<OID-name>-raw` per OID                    | the varbind as json, for everything the formats above do not cover                                                          |
| Type states        | boolean   | create an additional state `<OID-name>-type` per OID                   | the SNMP type the device answered with, e.g. `OctetString`                                                                  |


The option packet size can be used to reduce the number of OIDs queried within one request. Depending on the target device, the number of 
IODs queried with one request might be limited. In such a case the device might respond with error TOOBIG. In such a case try to 
reduce to value for option packet size.

The option **use MIB names** changes two things at once. The OID column of the OID sets then also
accepts a symbolic name such as `IF-MIB::ifDescr.1` (or `ifDescr.1` without the module), which the
adapter resolves to the numeric OID at startup using the uploaded MIB files. And the id of the
ioBroker state is no longer built from the OID name but from the MIB symbol, so the example above
ends up in `snmp.0.<device>.ifDescr.1` instead of `snmp.0.<device>.<OID-name>`.

Attention: switching this option changes the ids of the states of all OIDs that a MIB covers. The
objects written before keep their old ids and stay behind as orphans - delete them by hand if they
are no longer wanted. OIDs that no loaded MIB covers keep using their OID name.

## States and objects

For every active device the adapter creates one device object, a folder `info` with the status of
that device, and one state per active OID of the OID group assigned to it:

| id                              | type    | role                 | meaning                                                              |
|---------------------------------|---------|----------------------|----------------------------------------------------------------------|
| `snmp.<instance>.info.connection` | boolean | indicator.connected  | true while at least one device answers                               |
| `<device>`                      | device  | -                    | `common.statusStates` points to the two states below                 |
| `<device>.info.online`          | boolean | indicator.reachable  | true while the device answers                                        |
| `<device>.info.error`           | boolean | indicator.reachable  | true after an error, false again after the next successful read      |
| `<device>.info.error_text`      | string  | text                 | the message of the last error                                        |
| `<device>.<OID-name>`           | see format | value             | the value read; dots in the OID name become folders                  |
| `<device>.<OID-name>-type`      | string  | type.encoding        | SNMP type of the value, only with the option *type states*           |
| `<device>.<OID-name>-raw`       | string  | json                 | the varbind as it arrived, only with the option *raw states*         |

`<device>` is the name of the device; with the compatibility mode it is the IP address with `_`
instead of `.`. These ids are what scripts and charts refer to, so they do not change - with one
exception, which the option *use MIB names* documents above.

### Quality

Every value carries the ioBroker quality code, so a script can tell a real value from a missing one:

| quality | meaning                                                                             |
|---------|--------------------------------------------------------------------------------------|
| 0x00    | ok                                                                                    |
| 0x01    | the value could not be converted into the configured format                          |
| 0x02    | the device did not answer (timeout), the last value stays                            |
| 0x44    | the device reported an error, the value is set to null                               |
| 0x84    | the OID does not exist on this device (NoSuchInstance), the value is set to null      |

### Writing

An OID marked as *writeable* creates a writeable state which the adapter subscribes to. Setting it
without `ack` writes the value to the device with an SNMP `set`. The value is encoded back into the
SNMP type of the last value read, so such an OID has to have been read once before it can be
written - until then the adapter logs "cannot write to uninitialized state".

## OID Examples
The search for the manufacturer and MIB is successful in most cases. In addition, you can use MIB browser software to 
query your target device, i.e. https://www.ireasoning.com/mibbrowser.shtml

### Printers
For most printers, there is a standard. (PRINTER MIB)
http://www.oidview.com/mibs/0/Printer-MIB.html

For the Samsung CLP320 color laser, e.g. the following OIDs are valid.
- Number of printed pages: 1.3.6.1.2.1.43.10.2.1.4.1.1
- Black toner: 1.3.6.1.2.1.43.11.1.1.9.1.1
- Toner cyan: 1.3.6.1.2.1.43.11.1.1.9.1.2
- Toner magenta: 1.3.6.1.2.1.43.11.1.1.9.1.3
- Toner yellow: 1.3.6.1.2.1.43.11.1.1.9.1.4
- Life_drum unit: 1.3.6.1.2.1.43.11.1.1.9.1.7

### NAS Systems - Synology
Synology: By default, SNMP is disabled on Synology Diskstations and must be enabled in the WebUI. It is important that port 161 by default remains and community is set correctly. Mostly it is public.

https://global.download.synology.com/download/Document/MIBGuide/Synology_DiskStation_MIB_Guide.pdf

### USV 
For APC USVs you could check https://www.opsview.com/resources/monitoring/blog/apc-ups-monitoring-useful-oids


