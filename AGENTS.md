# AGENTS.md

Guidance for coding agents (and humans) working on this Homey app — a fork of `net.evenh.tydom` that adds Delta Dore Tydom 1.0 gateway support to Homey Pro.

## What this app is

A Homey SDK v3 app that connects to a local Delta Dore Tydom 1.0 gateway over the LAN and exposes its **lights** and **thermostats** as Homey devices. It does not use the Delta Dore cloud — all control is local.

Upstream project state: work-in-progress fork. Credentials are hardcoded in `app.ts` (there is no Homey settings page or pair-flow credential prompt). mDNS discovery is declared in `app.json` but not wired to any driver.

## Project layout

- `app.ts` — entrypoint. Creates the `TydomController` singleton with hardcoded credentials and calls `connect()` + `scan()` on init.
- `tydom/controller.ts` — singleton that wraps the `tydom-client` npm package. Connects to the gateway, scans devices, emits updates, and exposes `getDevices(category)` for pair flows.
- `tydom/typings.ts` — Tydom API types + `Categories` enum (LIGHTBULB, THERMOSTAT, OTHER, …).
- `tydom/helpers.ts` — endpoint→category resolution based on `first_usage` / metadata.
- `drivers/light/` — `driver.ts` calls `controller.getDevices(Categories.LIGHTBULB)` on pair; `device.ts` maps `onoff` / `dim` to `updateLightLevel`.
- `drivers/thermostat/` — same pattern for `target_temperature` / `measure_temperature` / `onoff`.
- `app.json` is generated from `.homeycompose/app.json` — edit the compose file, not the generated one.

## Install / reinstall

Prereq: `homey` CLI logged in and Homey Pro reachable on LAN.

```bash
homey app install
```

This runs `npm run build` (tsc) under the hood and pushes to the Homey.

After changing anything in `app.ts` or the drivers, rerun the same command. The app restarts automatically on install.

To tail logs during development:
```bash
homey app run
```

## Configuring credentials

Credentials live in `app.ts` around lines 29-31:

```ts
const hostname = '192.168.1.11';     // local IP of the Tydom gateway
const username = '001A2506DEB2';      // Tydom MAC, uppercase, no separators
const password = '<sticker password>'; // gateway sticker password (see below) — never commit
```

Note: `app.ts` ships with non-secret defaults for hostname and username but **no** password. The password must come from the Configure App page in Homey settings. Never commit the real password.

After editing, `homey app install` to push.

### Finding the hostname

Check your router DHCP table for a device with MAC prefix `00:1A:25:...` (Delta Dore) or browse `http://mediation.tydom.com` which redirects to your gateway.

### Finding the username (MAC)

Printed on the sticker on the back of the Tydom gateway. 12 uppercase hex chars, no colons.

### Finding the password

The Tydom gateway uses HTTP digest auth with a **random per-device password** printed on the sticker. It is:
- **not** derivable from the MAC/serial
- **not** the same as your Delta Dore cloud account password
- **not** the PIN used in the Tydom mobile app

If the sticker is missing or illegible, recover it one of these ways:

#### Option A — fetch from Delta Dore cloud (recommended, non-destructive)

Delta Dore's cloud stores the password in clear text and returns it to authenticated account holders. Auth is Azure AD B2C (ROPC flow).

```bash
EMAIL="you@example.com"          # Delta Dore account email (Tydom mobile app login)
PASS='your-account-password'     # Delta Dore account password — use single quotes for special chars
MAC="001A2506DEB2"               # your gateway MAC
CID="8782839f-3264-472a-ab87-4d4e23524da4"
SCOPE="openid profile offline_access https://deltadoreadb2ciot.onmicrosoft.com/iotapi/sites_management_gateway_credentials"

TOKEN_EP=$(curl -sS "https://deltadoreadb2ciot.b2clogin.com/deltadoreadb2ciot.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_AccountProviderROPC_SignIn" | jq -r .token_endpoint)

ACCESS=$(curl -sS -X POST "$TOKEN_EP" \
  -F "username=$EMAIL" -F "password=$PASS" \
  -F "grant_type=password" -F "client_id=$CID" -F "scope=$SCOPE" \
  | jq -r .access_token)

curl -sS "https://prod.iotdeltadore.com/sitesmanagement/api/v1/sites?gateway_mac=$MAC" \
  -H "Authorization: Bearer $ACCESS" | jq -r '.sites[0].gateway.password'
```

Notes:
- Scope must include `sites_management_gateway_credentials` — otherwise the `sites` endpoint returns 403.
- Azure B2C ROPC accepts `multipart/form-data` (what `curl -F` sends) and `application/x-www-form-urlencoded`.
- The returned password may contain shell-special chars (`&`, `$`, `=`, `+`, …). Use single quotes when pasting into `app.ts`.

#### Option B — mobile app proxy interception

Proxy your phone through mitmproxy / Proxyman, install the CA cert, open the Tydom app, and capture the response to `https://prod.iotdeltadore.com/sitesmanagement/api/v1/sites...`. The password is in `.sites[0].gateway.password`. iOS works out of the box; Android 7+ needs root or a patched APK.

#### Option C — factory reset

Hold the button next to the Tydom's power cable for ~15 s until the LED flashes fast violet, then set a new password from the Tydom mobile app. This may force re-pairing of Tydom-side devices.

## Pairing devices in Homey

Once the app is running with correct credentials:

1. Homey app → Devices → Add → Delta Dore Tydom
2. Pick **Light** or **Thermostat**
3. Homey calls `onPairListDevices` on the driver, which returns devices discovered during the `scan()` at app init
4. Select and add

If the list is empty: the connection probably failed. Check `homey app run` logs for digest auth errors (`401 Unauthorized` = wrong password or wrong MAC casing).

Supported device classes: **light** and **thermostat** only. Shutters, alarms, DIN modules, etc. are not implemented.

## Known issues / things to watch

- `app.ts` sets `NODE_TLS_REJECT_UNAUTHORIZED = '0'` globally — relaxed TLS is needed for the self-signed cert on the Tydom, but it disables TLS verification process-wide.
- `app.ts` opens the Node inspector on `0.0.0.0:9229` and calls `waitForDebugger()` when `debug = true`. Set `this.debug = false` in production, or the app hangs waiting for a debugger to attach.
- If `controller.connect()` throws in `onInit`, the app crashes — there's no retry loop.
- `TydomController` is a singleton shared between drivers. Both drivers call `TydomController.getInstance()` in their `onInit`, which requires `app.ts` to have created the instance first.
- `app.json` is generated — edit `.homeycompose/app.json` instead.

## Past bugs fixed

- `app.ts` had a duplicate `const logger` declaration (TS2451). Removed the first redundant line. Without this fix, `homey app install` fails at the TypeScript compile step.
- Tydom 1.0 uses pre-RFC-5746 TLS renegotiation, which modern Node rejects with `unsafe legacy renegotiation disabled`. Without the fix, `connect()` throws, `scan()` never runs, and the Homey pair screen hangs forever with an empty list. Fix: monkey-patch `tls.createSecureContext` at the top of `app.ts` to OR `SSL_OP_LEGACY_SERVER_CONNECT` into `secureOptions`. Same patch lives in `tydom-test/test-connect.js`.

## Local test harness

`tydom-test/test-connect.js` connects directly with the `tydom-client` package and dumps `/configs/file` + `/groups/file` + `/devices/meta`, bypassing Homey entirely. Use it to verify credentials, TLS, and that the gateway returns expected devices before debugging the Homey side.

```bash
node tydom-test/test-connect.js                                    # uses hardcoded defaults
TYDOM_HOST=... TYDOM_USER=... TYDOM_PASS=... node tydom-test/test-connect.js
DEBUG='' node tydom-test/test-connect.js                           # silence tydom-client wire log
```

Clean output lists one line per endpoint: `deviceId`, `endpointId`, `name`, `firstUsage` (e.g. `hvac` → thermostat, `lightbulb` → light).

## Handy references

- Upstream repo: https://github.com/evenh/net.evenh.tydom
- `tydom-client` (what this app uses): https://github.com/mgcrea/tydom-client
- `homebridge-tydom` (sister Homebridge project by the same `tydom-client` author): https://github.com/mgcrea/homebridge-tydom
- Home Assistant Tydom integration (authoritative reference for the Azure B2C auth flow): https://github.com/CyrilP/hass-deltadore-tydom-component
- Delta Dore factory-reset guide: https://www.deltadore.co.uk/news/advice/reset-password-tydom

## When editing as an agent

- Build verification: `npm run build` (runs `tsc`). Do this before `homey app install` if you only want to catch type errors quickly.
- Do NOT commit real credentials. Keep `app.ts` credential edits local only.
- Do NOT edit `app.json` directly — regenerated from `.homeycompose/app.json` on every install.
- When adding a new driver, follow the light/thermostat pattern: create `drivers/<name>/{driver,device}.ts` + `driver.compose.json`, extend `Categories` in `tydom/typings.ts`, and wire up category resolution in `tydom/helpers.ts`.
