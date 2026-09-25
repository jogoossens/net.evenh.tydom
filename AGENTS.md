# AGENTS.md

Guidance for coding agents (and humans) working on this Homey app — a fork of `net.evenh.tydom` that adds Delta Dore Tydom gateway support (1.0, 2.0, Home, Pro) to Homey Pro.

## What this app is

A Homey SDK v3 app that connects to a local Delta Dore Tydom gateway (1.0, 2.0, Home, Pro — same local API; production-tested on Tydom Home) over the LAN and exposes its **lights** and **thermostats** as Homey devices. It does not use the Delta Dore cloud — all control is local.

The app is meant for many users: **nothing user-specific is hardcoded** — every gateway comes from the Configure App settings page. The Delta Dore cloud is used only there, once, to import gateway credentials. mDNS discovery is declared in `app.json` but not wired to any driver.

## Project layout

- `app.ts` — entrypoint. Creates the `Gateways` manager and re-attaches devices when the gateway list changes. Nothing waits for a connection.
- `tydom/gateways.ts` — owns the `gateways` setting (`{name, mac, hostname, password}[]`): keeps one `TydomController` per entry in sync (changes apply immediately, no restart), fills in / follows gateway IPs from MAC discovery (`.homeycompose/discovery/tydom.json`, Delta Dore OUI `00:1A:25` = `[0, 26, 37]`), imports from the cloud, migrates old flat `hostname`/`username`/`password` keys.
- `tydom/controller.ts` — one instance per gateway (keyed by MAC); wraps `tydom-client`. Connects + scans in the background with retries (10/30/60 s), exposes `state` / `lastError` / `ready`, emits `ready` / `unavailable`, and `getDevices(category)` for pairing.
- `tydom/device-link.ts` — links a device to its gateway's controller: unavailable with the reason while the gateway is down, re-seeded when it's back.
- `tydom/pairing.ts` + `drivers/*/pair/start.html` — pair flow shared by both drivers: `start` view (skipped when a gateway is connected) → button press, `login_credentials` (Tydom app account) or sticker password → `list_devices`. Keep both `start.html` copies identical.
- `tydom/local-pairing.ts` — button pairing: after a short press on the gateway, `wss://<ip>/mediation/client?mac=<MAC>&appli=1` answers `GET /configs/gateway/password` without auth (otherwise 401). Verified on Tydom Home firmware 03.22.42.
- `settings/index.html` — Configure App page: live status per gateway (`GET /status`), name / IP / MAC / password, account import (`POST /cloud-login`).
- `tydom/typings.ts` — Tydom API types + `Categories` enum (LIGHTBULB, THERMOSTAT, OTHER, …).
- `tydom/cloud.ts` — Delta Dore cloud sign-in (Azure B2C, see Option A below): lists the account's sites (`GET sitesmanagement/api/v2/sites`) and reads each gateway's MAC + password (`GET sitesmanagement/api/v1/sites/{id}`). Account password is never stored.
- `api.ts` — settings-page endpoints `POST /cloud-login` and `GET /status`.
- `tydom/helpers.ts` — endpoint→category resolution based on `first_usage` / metadata.
- `drivers/light/` — `device.ts` maps `onoff` / `dim` to `updateLightLevel`.
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

Normally done from pairing (Devices → + → Delta Dore Tydom): button press, Tydom app account or sticker password; the IP comes from MAC discovery. The Configure App page can import, edit or remove gateways. Stored in the `gateways` setting — never in code. Never commit real credentials, MACs, IPs or device ids; use placeholders like `001A25XXXXXX` / `192.168.1.50`.

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
MAC="001A25XXXXXX"               # your gateway MAC
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
3. The first time, the `start` view connects a gateway; then `list_devices` returns the devices from each connected gateway's `scan()`
4. Select and add

If the list is empty: the connection probably failed. Check `homey app run` logs — `401 Unauthorized` (or no answer at all) usually means a wrong gateway password; the MAC isn't checked by the gateway. Also make sure no other client (e.g. the Tydom mobile app on the LAN) holds the gateway's single local connection.

Supported device classes: **light** and **thermostat** only. Shutters, alarms, DIN modules, etc. are not implemented.

## Known issues / things to watch

- `app.ts` sets `NODE_TLS_REJECT_UNAUTHORIZED = '0'` globally — relaxed TLS is needed for the self-signed cert on the Tydom, but it disables TLS verification process-wide.
- `app.ts` opens the Node inspector on `0.0.0.0:9229` and calls `waitForDebugger()` when `debug = true`. Set `this.debug = false` in production, or the app hangs waiting for a debugger to attach.
- Multi-gateway: devices store the gateway `mac` in their data and find their controller with `TydomController.find(mac)`; devices paired before multi-gateway support have no `mac` and fall back to the first gateway.
- `tydom-client`'s `close()` does **not** stop its `retryOnClose` auto-reconnect, so a closed client keeps reconnecting and hogs the gateway's single connection. Controllers therefore create clients with `retryOnClose: false` and reconnect themselves.
- `app.json` is generated — edit `.homeycompose/app.json` instead.
- A Tydom gateway serves **one local connection at a time**: a second client gets no answer (the first is unaffected). The Tydom mobile app on the LAN, another Homey, or a `tydom-test/` script all compete for it. The button-pairing websocket route is separate and works while the app is connected.
- A wrong gateway password gets either a `401` or silence, and the gateway can stay silent for ~a minute afterwards — wait before retrying when testing. The **username/MAC is not checked** locally (any value connects), so a successful connection only proves IP + password.

## Past bugs fixed

- `app.ts` had a duplicate `const logger` declaration (TS2451). Removed the first redundant line. Without this fix, `homey app install` fails at the TypeScript compile step.
- Tydom 1.0 uses pre-RFC-5746 TLS renegotiation, which modern Node rejects with `unsafe legacy renegotiation disabled`. Without the fix, `connect()` throws, `scan()` never runs, and the Homey pair screen hangs forever with an empty list. Fix: monkey-patch `tls.createSecureContext` at the top of `app.ts` to OR `SSL_OP_LEGACY_SERVER_CONNECT` into `secureOptions`. Same patch lives in `tydom-test/test-connect.js`.

## Local test harness

`tydom-test/test-connect.js` connects directly with the `tydom-client` package and dumps `/configs/file` + `/groups/file` + `/devices/meta`, bypassing Homey entirely. Use it to verify credentials, TLS, and that the gateway returns expected devices before debugging the Homey side.

```bash
TYDOM_HOST=... TYDOM_USER=... TYDOM_PASS=... node tydom-test/test-connect.js   # or tydom-test/.env.json
DEVICE=<deviceId> node tydom-test/test-boost.js                    # device-specific scripts take DEVICE (+ optional ENDPOINT)
DEBUG='' node tydom-test/test-connect.js                           # silence tydom-client wire log
```

`tydom-test/replay-traces.js <ha-repo>/tools` replays Home Assistant's recorded gateway traffic (TYDOM1/2, Home, Pro, Tywell Pro) through `resolveEndpointCategory` — use it when adding device types; there's no real hardware for anything but Tybox thermostats.

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
