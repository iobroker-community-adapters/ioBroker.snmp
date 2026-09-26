# Informationen zum SNMP-Adapter

## Allgemeine Information
Das Simple Network Management Protocol (SNMP) ist ein Internet-Standardprotokoll zum Sammeln und Organisieren von Informationen über
verwaltete Geräte in IP-Netzwerken und zum Ändern dieser Informationen, um das Geräteverhalten zu ändern. Geräte, die normalerweise 
SNMP unterstützen umfasst Kabelmodems, Router, Switches, Server, Workstations, Drucker und mehr.

SNMP wird in der Netzwerkverwaltung häufig zur Netzwerküberwachung verwendet. SNMP legt Verwaltungsdaten in Form von Variablen offen
die in einer Management Information Base (MIB) organisiert sind und den Systemstatus und die Konfiguration beschreiben.
Diese Variablen können dann von Anwendungen aus der Ferne abgefragt (und unter Umständen manipuliert) werden.

Drei bedeutende Versionen von SNMP wurden entwickelt und bereitgestellt. SNMPv1 ist die ursprüngliche Version des Protokolls.
Neuere Versionen, SNMPv2c und SNMPv3, bieten Verbesserungen in Leistung, Flexibilität und Sicherheit.
(Text entnommen aus Wikipedia, der freien Enzyklopädie)

Der SNMP-Adapter verwendet die sogenannten OID’s (Object Identifier) um diese Werte aus dem konfigurierten Gerät auszulesen.

## Konfiguration
Der Adapter fragt bestimmte OIDs (Objektkennungen) ab, die in OID-Gruppen gruppiert sind, die wiederum Geräten zugeordnet sind. Die
Konfigurationsdaten werden auf mehreren Registerkarten eingegeben:

### TAB OID-Gruppen
Hier geben Sie alle OIDs an, die vom Adapter abgefragt werden sollen, eine OID pro Zeile.

<p align=center><img src="img/snmp_tab_oids.jpg" width="600" /></p>

| Parameter    | Typ       | Beschreibung                                              | Kommentar                                                                                                             |
|--------------|-----------|-----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| aktiv        | boolesch  | wenn auf true gesetzt, wird diese OID verwendet           | kann verwendet werden, um eine einzelne OID zu deaktivieren                                                           |
| OID-Gruppe   | Text      | Name der OID-Gruppe                                       | wird verwendet, um die Gruppe dem Gerät zuzuweisen                                                                    |
| OID-Name     | Text      | Name, der der OID zugeordnet ist                          | wird verwendet, um den Datenpunkt zu benennen                                                                         |
| OID          | Text      | oid-Zeichenfolge (1.2.3.4.)                               | oid-Zeichenfolge, wie vom Gerätehersteller angegeben                                                                  |
| beschreibbar | boolesch  | sollte auf true gesetzt werden, wenn OID beschreibbar ist | reserviert für zukünftige Verwendung                                                                                  |
| optional     | boolesch  | sollte auf true gesetzt werden, wenn OID optional ist     | wenn auf true gesetzt, wird kein Fehler ausgelöst wenn oid unbekannt ist (Funktionalität nicht verfügbar mit snmp V1) |


Sie können einfach jede OID aktivieren/deaktivieren, indem Sie das aktive Flag setzen. Beachten Sie, dass die ID des ioBroker-Zustands zum Speichern der gelesenen Daten
 normalerweise zusammengesetzt wird aus dem Gerätenamen (siehe Registerkarte Geräte) und dem hier angegebenen OID-Namen. Sie können Punkte innerhalb des OID-Namens verwenden
um eine Ordnerstruktur aufzubauen.

Wenn einige OIDs nicht immer verfügbar sind, sollten Sie das Flag optional setzen, um unnötige Fehler zu vermeiden. Bitte beachten Sie, dass dies
die Verwendung der Protokollversionen snmp v2c oder snpm v3 erfordert.
 
### TAB-Geräte
Hier legen Sie fest, welche Geräte abgefragt werden sollen.

<p align=center><img src="img/snmp_tab_devices.jpg" width="600" /></p>

| Parameter                             | Typ        | Beschreibung                                                           | Kommentar                                                                                                                                                    |
|---------------------------------------|------------|------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| aktiv                                 | boolesch   | wenn auf true gesetzt, wird das Gerät verwendet                        | kann verwendet werden, um ein einzelnes Gerät zu deaktivieren                                                                                                |
| Name                                  | Text       | Name des Geräts                                                        | wird verwendet, um Namen von Datenpunkten zu erstellen                                                                                                       |
| IP-Adresse                            | Text       | IP-Adresse (IPv4 oder IPv6) oder Domänenname mit optionaler Portnummer | IPv4 1.2.3.4 oder 1.2.3.4:161, IPv6 2001:abcd::30ff, IPv6 [2001:abcd::30ff] oder [2001:abcd::30ff]:161, Domäne myhost.domain.org oder myhost.domain .org:161 |
| IPv6                                  | boolesch   | wenn gesetzt soll IPv6 verwendet werden                                |                                                                                                                                                              |
| OID-Gruppe                            | Text       | auf der Registerkarte IOD-Gruppen angegebene OID-Gruppe                | Eine OID-Gruppe kann mehr als einem Gerät zugeordnet werden                                                                                                  |
| SNMP-Version                          | wählen Sie | zu verwendende SNMP-Version                                            |                                                                                                                                                              |
| Community (v1, v2c) oder Auth-ID (v3) | Text       | Community für SNMP v1 oder V2c, Autorisierungsgruppe für SNMP v3       |                                                                                                                                                              |
| Zeitüberschreitung (Sek.)             | Nummer     | Verarbeitungszeitüberschreitung in Sekunden                            |                                                                                                                                                              |
| Wiederholung (Sek.)                   | Nummer     | Wiederholungsintervall in Sekunden                                     |                                                                                                                                                              |
| Abfrage (Sek.)                        | Nummer     | Abfrageintervall in Sekunden                                           |                                                                                                                                                              |

### TAB-Autorisierung
Diese Registerkarte enthält SNMP V3-Autorisierungsinformationen.

<p align=center><img src="img/snmp_tab_authorization.jpg" width="600" /></p>

| Parameter                 | Typ     | Beschreibung                       | Kommentar                                       |
|---------------------------|---------|------------------------------------|-------------------------------------------------|
| Name (ID)                 | Text    | ID der Berechtigungsdaten          | muss mit Auth-Id bei Tab-Geräten übereinstimmen |
| Sicherheitsstufe          | Auswahl | gewünschte Sicherheitsmethode      | siehe Beschreibung                              |
| Benutzername              | Text    | Benutzername zur Authentifizierung |                                                 |
| Methode                   | Auswahl | Passwort-Hashing-Methode           | Unterstützte Methoden sind md5 oder sha         |
| Autorisierungsschlüssel   | Text    | Passwort zur Authentifizierung     |                                                 |
| Verschlüsselung           | Auswahl | Verschlüsselungsverfahren          |                                                 |
| Verschlüsselungsschlüssel | Text    | Verschlüsselungsschlüssel          |                                                 |

Beachten Sie, dass Name(id) eindeutig sein muss.

Bei Auswahl des snmp V3-Protokolls ist eine erweiterte Authentifizierung erforderlich. In der Liste der Geräte ab Tab Geräte 
geben Sie in der Spalte Auth-Id den Namen eines Authentifizierungsblocks.

Auf dieser Registerkarte müssen Sie die gewünschte Sicherheitsstufe wie folgt auswählen:
* Minimum - nur ein Benutzername ist erforderlich
* Authentifizierung - Benutzername und Passwort sind erforderlich
* Authentifizierung und Verschlüsselung - Benutzername, Passwort und Verschlüsselungsschlüssel sind erforderlich.

Bitte beachten Sie, dass die angegebene Sicherheitsstufe vom Zielgerät unterstützt werden muss und Benutzername, Passwort und Verschlüsselungsschlüssel übereinstimmen müssen
die am Zielgerät eingegebenen Daten. Sie können denselben Autorisierungsblock für mehrere Geräte verwenden, solange sie dieselben Daten verwenden.

### TAB MIB
Hier laden Sie die MIB-Dateien Ihrer Geräte hoch und sehen sich deren Inhalt an.

| Parameter    | Typ   | Beschreibung                | Kommentar                                                                                    |
|--------------|-------|-----------------------------|----------------------------------------------------------------------------------------------|
| MIB-Dateien  | Datei | MIB-Dateien Ihrer Geräte    | alle hochgeladenen Dateien liegen in einem Ordner, eine MIB kann also eine andere importieren |

Die mit dem Adapter ausgelieferten MIBs (SNMPv2-MIB, RFC1213-MIB, IF-MIB und die weiteren
SMI-Basismodule) sind immer verfügbar und müssen nicht hochgeladen werden.

Unter dem Upload zeigt der **MIB-Browser** den Inhalt der MIB-Dateien. Er hat zwei Quellen:

* **MIB-Datei** - die in der MIB definierte Struktur: Name, OID, Syntax, Zugriffsrechte und der
  DESCRIPTION-Text als Tooltip.
* **Gerät (live)** - der Adapter liest das ausgewählte Gerät ab der angegebenen OID aus und zeigt
  die tatsächlich vorhandenen Instanzen mit ihren aktuellen Werten. Das Ergebnis ist auf 500 Werte
  begrenzt, geben Sie also eine ausreichend genaue Start-OID an. Dafür muss die Instanz laufen.

Mit dem Plus-Symbol einer Zeile wird diese OID in die OID-Sets übernommen, und zwar in die Gruppe,
die neben dem Filter eingetragen ist. Der OID-Name kommt aus der MIB, das Format wird auf
*Automatisch* gesetzt und *schreibbar* wird aus der MAX-ACCESS-Klausel der MIB übernommen.

### TAB-Optionen
Hier legen Sie einige allgemeine Optionen fest

<p align=center><img src="img/snmp_tab_options.jpg" width="600" /></p>

| Parameter            | Typ      | Beschreibung                                                                     | Kommentar                                                                                                                                  |
|----------------------|----------|----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| Paketgröße           | Ganzzahl | maximale Anzahl von OIDs, die innerhalb einer einzigen Anfrage gesendet werden   | reduzieren Sie diesen Wert bei TOOBIG-Fehlern                                                                                              |
| Kompatibilitätsmodus | boolesch | wenn diese Option aktiviert ist, basieren die Datenpunktnamen auf der IP-Adresse | HINWEIS: veraltet - nicht mehr verwenden. Dieses Flag funktioniert nicht mit IPv6-Adressen. Kann in zukünftigen Versionen entfernt werden. |
| MIB-Namen verwenden | boolean  | OID-Feld akzeptiert symbolische MIB-Namen, Objekt-IDs folgen der MIB | siehe unten. ACHTUNG: Das Umschalten ändert die Objekt-IDs bestehender OIDs |


Die Option packetsize kann verwendet werden, um die Anzahl der abgefragten OIDs innerhalb einer Anfrage zu reduzieren. Je nach Zielgerät ist die Anzahl der
IODs, die mit einer Anfrage abgefragt werden kann möglicherweise begrenzt. In einem solchen Fall antwortet das Gerät möglicherweise mit Fehler TOOBIG. Versuchen Sie es in einem solchen Fall
den Wert für Option packetsize zu reduzieren.

Die Option **MIB-Namen verwenden** ändert zwei Dinge gleichzeitig. Die OID-Spalte der OID-Sets
akzeptiert dann auch einen symbolischen Namen wie `IF-MIB::ifDescr.1` (oder `ifDescr.1` ohne Modul),
den der Adapter beim Start über die hochgeladenen MIB-Dateien in die numerische OID auflöst. Und die
ID des ioBroker-States wird nicht mehr aus dem OID-Namen gebildet, sondern aus dem MIB-Symbol - das
Beispiel landet also in `snmp.0.<Gerät>.ifDescr.1` statt in `snmp.0.<Gerät>.<OID-Name>`.

Achtung: Das Umschalten dieser Option ändert die IDs der States aller OIDs, die von einer MIB
abgedeckt sind. Die vorher geschriebenen Objekte behalten ihre alten IDs und bleiben als Waisen
zurück - löschen Sie sie bei Bedarf von Hand. OIDs, die von keiner geladenen MIB abgedeckt sind,
verwenden weiterhin ihren OID-Namen.

## OID-Beispiele
Die Suche nach Hersteller und MIB ist in den meisten Fällen erfolgreich. Zusätzlich können Sie eine mib-Browser-Software verwenden
um ihr Zielgerät abzufragen, z. B. https://www.ireasoning.com/mibbrowser.shtml

### Drucker
Für die meisten Drucker gibt es einen Standard. (DRUCKER-MIB)
http://www.oidview.com/mibs/0/Printer-MIB.html

Für den Samsung CLP320 Farblaser z.B. die folgenden OIDs sind gültig.

Anzahl gedruckter Seiten: 1.3.6.1.2.1.43.10.2.1.4.1.1

Schwarzer Toner: 1.3.6.1.2.1.43.11.1.1.9.1.1

Toner Cyan: 1.3.6.1.2.1.43.11.1.1.9.1.2

Toner Magenta: 1.3.6.1.2.1.43.11.1.1.9.1.3

Toner gelb: 1.3.6.1.2.1.43.11.1.1.9.1.4

Life_drum-Einheit: 1.3.6.1.2.1.43.11.1.1.9.1.7

### NAS-Systeme - Synology
Synology: Standardmäßig ist SNMP auf Synology Diskstations deaktiviert und muss in der WebUI aktiviert werden. Wichtig ist, dass der Port 161 standardmäßig erhalten bleibt und die Community richtig eingestellt ist. Meistens ist es öffentlich.

https://global.download.synology.com/download/Document/MIBGuide/Synology_DiskStation_MIB_Guide.pdf