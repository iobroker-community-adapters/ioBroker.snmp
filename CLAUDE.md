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
npm run build            # tsc -p tsconfig.build.json  -> build/
npm run watch            # same, incremental
npm run check            # type check only (tsc -p tsconfig.json --noEmit)
npm run lint             # eslint -c eslint.config.mjs
npx eslint -c eslint.config.mjs --fix   # the ONLY formatter - never run prettier separately
npm run test:package     # mocha test/packageFiles
npm run test:integration # mocha test/integrationAdapter - fails if a js-controller is running
npm run translate        # translate-adapter -b admin/i18n/en.json
```

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
src/lib/snmpSession.ts    create / close a session, promisified get and set
src/lib/installUtils.ts   migration of pre-2.0.0 configurations, defaults for newer attributes
admin/jsonConfig.json     config dialog (4 tabs), labels are i18n keys like `lblOidGroup`
admin/i18n/<lang>.json    flat translation files, 11 languages, `en.json` is the reference
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

State quality codes in use: `0x00` ok, `0x01` conversion error, `0x02` connection problem,
`0x44` device reported an error, `0x84` sensor/varbind reported an error.

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
  JavaScript type that snmp type produces.

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
