# CLAUDE.md — ioBroker.snmp

## What this adapter does

Polls SNMP OIDs from network devices (printers, switches, UPS, …) and writes the values into
ioBroker states. One reader session per device, `get` requests in chunks, values decoded according
to a per-OID format setting. Writeable OIDs are written back with `set` when the state is changed
without `ack`.

Supported: SNMP v1, v2c and v3 (authentication + encryption), IPv4 and IPv6, optional port suffix
on the address (`1.2.3.4:1161`, `[fe80::1]:1161`).

## Commands

```bash
npm run build-backend    # tsc -p tsconfig.build.json  -> build/
npm run build            # build-backend + tasks.ts (vite build of src-admin -> admin/custom/)
npm run watch            # backend only, incremental
npm run check            # type check the backend (tsc -p tsconfig.json --noEmit)
npm run check-tasks      # type check tasks.ts
npm run lint             # eslint -c eslint.config.mjs
npx eslint -c eslint.config.mjs --fix   # the ONLY formatter - never run prettier separately
npm run test:package     # mocha test/packageFiles (downloads the schemas - fails without network)
npm run test:unit        # mocha test/mibStore test/mibBrowser test/utils test/varbind
npm run test             # test:package + test:unit
npm run test:integration # mocha test/integrationAdapter - fails if a js-controller is running
npm run translate        # translate-adapter -b admin/i18n/en.json
npm run npm              # npm i in the root and in src-admin
npm run 0-clean ... 3-copy   # the single steps of tasks.ts, for debugging a failed admin build
```

The admin component is built separately: `cd src-admin && npm i` once, then `npm run build` in the
root drives it. `admin/custom/` and `src-admin/build/` are generated and gitignored.

`build/` is generated and gitignored. There is **no** `prepare` script on purpose: the build runs
in `npm run build` and in the CI (`build: true` in the GitHub action), nowhere else. Because
`build/` is not in the repository, `io-package.json` sets `common.nogit: true` — the adapter can
only be installed from npm, not from GitHub.

## Architecture

```
src/main.ts               class Snmp extends utils.Adapter - the whole adapter lifecycle
src/lib/constants.ts      F_* value formats, SNMP_V*, auth/encryption protocol codes
src/lib/types.ts          DeviceContext (CTX), OidChunk, StateCacheEntry, config row types
src/lib/adapter-config.d.ts  typed `this.config` - keep in sync with io-package.json + jsonConfig
src/lib/utils.ts          name2id, ip2ipStr, oidFormat2StateType, oidObjType2Text
src/lib/varbind.ts        varbindDecode / varbindEncode - snmp value <-> ioBroker state value
                          (F_HEX renders the bytes as "76 01 04", hex2buffer() reads them back)
src/lib/snmpSession.ts    create / close a session, promisified get and set
src/lib/installUtils.ts   migration of pre-2.0.0 configurations, defaults for newer attributes
src/lib/mib.ts            MibStore - parses the uploaded MIB files, resolves symbol <-> oid
src/lib/mibTypes.ts       payload of the `mib*` sendTo commands (contract with the admin component)
admin/jsonConfig.json     config dialog (5 tabs), labels are i18n keys like `lblOidGroup`
admin/i18n/<lang>.json    flat translation files, 11 languages, `en.json` is the reference
src-admin/src/MibBrowser.tsx  the MIB browser, a jsonConfig `type: "custom"` component
src-admin/src/SetupWizard.tsx the three step wizard of the device tab, also `type: "custom"`
src-admin/src/MibTree.tsx     the MIB tree as a table, used by both of them
src-admin/src/types.ts    copy of mibTypes.ts + the pure row/filter logic (unit tested)
tasks.ts                  vite build of src-admin -> admin/custom/
```

### Lifecycle

`onReady()` → migrate/update the instance config (`InstallUtils`, may `terminate()` for a restart)
→ `validateConfig()` (also normalizes and clamps the config values in place; on failure the
instance disables itself) → `cleanupStates()` → `setupContices()` builds one `DeviceContext` per
active device with its OIDs split into chunks of `optChunkSize` → `initAllObjects()` →
`createReaderSession()` per device → a 15 s interval updates `info.connection`.

Per device: `createReaderSession()` opens the session, reads once, then polls every `devPollIntvl`.
The session's `close` event schedules a retry after `devRetryIntvl`, the `error` event closes the
session (unless `optNoCloseOnError`), which in turn triggers the retry through `close`.

### Where states are written

| id | meaning |
|---|---|
| `info.connection` | true while at least one device is online |
| `<devId>.info.online` / `.error` / `.error_text` | per-device status, referenced by `common.statusStates` |
| `<devId>.<oidName>` | the decoded value; `oidName` dots become folders |
| `<devId>.<oidName>-type` | snmp object type, only with `optTypeStates` |
| `<devId>.<oidName>-raw` | raw varbind as json, only with `optRawStates` |

`<devId>` is the device name, or the ip address with `_` instead of `.` when `optUseName` is set
(compatibility mode for configurations from before 1.0.0). State ids must not change — they are
what user scripts and charts refer to.

The role of a state follows its type, `oidStateRole()` decides it: `value`/`level` for numbers,
`indicator`/`switch` for booleans, `text` for strings and the generic `state` for the format
"automatic". Only roles of the ioBroker role list may be used - the adapter checker reports the
others, which is how the former `type.encoding` of the `-type` states was found.

State quality codes in use: `0x00` ok, `0x01` conversion error, `0x02` connection problem,
`0x44` device reported an error, `0x84` sensor/varbind reported an error.


### Setup wizard

`SetupWizard` is the second custom component, placed above the device table. It collects a device,
uploads MIB files into the same file storage the `fileSelector` uses, and writes one row into
`devs` plus one row per picked oid into `oids` - it saves nothing itself, the save button of the
dialog does that. Its live read sends the whole device row as `dev` with `mibChildren`, so a device
which has just been entered can be read before it is part of the instance configuration.

Everything it decides (`buildDeviceRow`, `deviceIssues`, `pickNodes`) is a pure function in
`src-admin/src/types.ts` and unit tested; the defaults of `buildDeviceRow` have to stay in sync
with the column defaults of the device table in `admin/jsonConfig.json`.

### MIB browser

The MIB files are uploaded by the `fileSelector` of the config dialog into the file storage of the
`snmp.<instance>.mibs` meta object. `syncMibs()` materializes them in
`<instanceDataDir>/mibs/` - net-snmp's parser can only read files and resolves a module's IMPORTS
relative to the file it is reading, so all of them have to live in one directory.

The component never touches the MIBs itself; it asks the running instance over `sendTo`. The
devices it offers are not requested - they are read from the `devs` table of the dialog, so a device
which has just been entered can be equipped with oids before the configuration is saved:

| command | payload | answer |
| --- | --- | --- |
| `mibModules` | - | the loaded modules plus the parse errors per file |
| `mibReload` | - | same, but re-reads the uploaded files first |
| `mibChildren` | `{ device, oid }` or `{ dev, oid }` | the direct children of that oid on the device, at most `MIB_CHILDREN_LIMIT`; `dev` is a complete device row and lets the setup wizard read a device which is not saved yet |
| `mibSubtree` | `{ device, oid }` or `{ dev, oid }` | every value below that oid as a flat list, at most `MIB_SUBTREE_LIMIT` - one walk, for "take over the whole subtree" |

`src/lib/mibTypes.ts` and `src-admin/src/types.ts` describe the same payload but are separate files
(the component is its own bundle and cannot import from `build/`). **Change both together** -
`test/mibBrowser.js` has a `contract` block that catches a drift between them.

The browser has one source: the device. It is read live and the MIB files only name what comes
back - `getModules()` reports the root oid of every module so that the module list can jump there.

A device is read one level at a time: `readChildren()` asks for the first value below the node with
`getNext`, which names the first child, a second `getNext` tells whether that child carries more
than this one value (folder or leaf), and the next request starts behind the whole child, so its
subtree is skipped - with `<child>.<MAX_SUB_ID>`, because the rows of a table carry their value at
`<column>.<n>` itself and a getNext for the next sub id of the level would jump over every second
row. That is two requests per child instead of walking everything below the node -
what makes the browser usable on a device with thousands of values. The component keeps the answer
in the tree with `insertChildren()` and asks again when the next folder is opened.

SNMP v1 has no "end of mib view": a `getNext` behind the last value answers with the error
`NoSuchName`, which `readChildren()` has to read as "this level is complete" - otherwise every
level of a v1 device ends in an error message.

net-snmp's MIB parser does not throw on a malformed file: it writes to `console.warn` and registers
a module literally named `undefined`. `loadOneFile()` therefore captures the console and compares the
module list before and after, so that the admin can show the user why an upload was rejected.

An oid of a MIB file addresses the object, not a value: a scalar is read at `<oid>.0`, a column of
a table needs the index of a row. `MibStore.isColumn()` tells the two apart - the row entry of a
table is the only entry with an INDEX resp. AUGMENTS clause - and reports it as `column` on the
tree node. `buildOidRow()` appends the `.0` of a scalar, `stateIdFor()` drops it again, so the
state of `SNMPv2-MIB::sysName.0` is `sysName` while `IF-MIB::ifDescr.1` stays `ifDescr.1`.

With `optUseMibNames` the OID column may hold `IF-MIB::ifDescr.1`, `resolveConfiguredOid()` resolves
it to the numeric oid and derives the state id from the MIB symbol instead of from `oidName`.
Switching the option therefore changes existing object ids - that is documented and intended.

## Conventions

- Parameters of the adapter's own functions are prefixed with `p` (`pCTX`, `pStateId`) — historical,
  but consistent, so keep it.
- Timers always through `this.setTimeout` / `this.setInterval` / `this.clearTimeout` /
  `this.clearInterval`, never the global ones, so adapter-core cleans them up on unload.
- `this.namespace` instead of rebuilding `snmp.<instance>`; never `require('./package.json')` from
  `src/` — it would resolve to `build/package.json` at runtime.
- Config values may arrive as strings from old configurations. Comparisons normalize with
  `Number(...)` before comparing — that is what the `==` comparisons of the JavaScript version did.
- No `any`. Data coming from net-snmp is narrowed per `ObjectType` with a comment explaining which
  JavaScript type that snmp type produces. `createModuleStore()` is typed as `any` by
  `@types/net-snmp`, so `src/lib/mib.ts` declares the part of that API it uses.
- Everything the MIB browser decides (which row to build, how to filter) lives in
  `src-admin/src/types.ts` as pure functions, so it can be unit tested without a DOM. The React
  component only renders.

### Deliberate legacy behaviour (do not "fix" without a separate commit)

- `oidObjType2Text` reports type 2 as `Integer32`, 65 as `Counter32`, 66 as `Unsigned32`, because
  net-snmp aliases those codes and the later table entry wins. The `-type` states have always
  contained this wording.
- `json2boolean` / `json2number` reject `data: false` resp. `data: 0` as "data element missing".
- `validateConfig()` does not reject an snmp v3 device without an authorization id: the original
  check tested a misspelled attribute and never fired. Enabling it would disable existing instances.
- The state cache `STATEs` is used for two different purposes under the same key (see the comment
  on `StateCacheEntry`); `onStateChange` reports "cannot write to uninitialized state" when the
  entry currently holds the other shape.

## Release

`.releaseconfig.json` uses the `iobroker`, `license` and `manual-review` plugins.

```bash
npm run build && npm run check && npm run lint && npm run test:package
npm run release            # release-script, add patch/minor/major as needed
```

The changelog entry goes under `### **WORK IN PROGRESS**` in `README.md`; `common.news` in
`io-package.json` is maintained by the release script, never by hand.
