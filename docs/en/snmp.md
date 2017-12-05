# SNMP adapter information

## General information

The SNMP protocol (Simple Network Management Protocol) was developed to centrally manage all network devices. These include printers, routers, switches, servers, computers, etc.

The SNMP adapter uses the so-called OID's (Object Identifier) ​​to read these values ​​from the respective device.

## Administration / Admin page
! [Adapter_admin_konfiguration] (img / adminpage.jpg)

1. RetryTimeout - retry time in ms
2. connectTimeout - Connection attempt in ms
3. pollInterval - polling period every XXXX ms

## Printers

For most printers, there is a standard. (PRINTER MIB)
http://www.oidview.com/mibs/0/Printer-MIB.html

For the Samsung CLP320 color laser, e.g. the following OIDs are valid.
Number of printed pages: 1.3.6.1.2.1.43.10.2.1.4.1.1
Black toner: 1.3.6.1.2.1.43.11.1.1.9.1.1
Toner cyan: 1.3.6.1.2.1.43.11.1.1.9.1.2
Toner magenta: 1.3.6.1.2.1.43.11.1.1.9.1.3
Toner yellow: 1.3.6.1.2.1.43.11.1.1.9.1.4
Lebensdauer_Bandeinheit: 1.3.6.1.2.1.43.11.1.1.9.1.6
Life_drum unit: 1.3.6.1.2.1.43.11.1.1.9.1.7

## NAS Systems - Example

Synology: By default, SNMP is disabled on Synology Diskstations and must be enabled in the WebUI. It is important that the port 161 by default remains and community is set correctly. Mostly it is public.

https://global.download.synology.com/download/Document/MIBGuide/Synology_DiskStation_MIB_Guide.pdf

## The search for the manufacturer and MIB is successful in most cases.
