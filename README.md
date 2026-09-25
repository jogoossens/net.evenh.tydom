# Delta Dore Tydom for Homey Pro

> # ✅ Verified working on Homey Pro + Tydom 1.0 / Tydom Home
>
> **This repository is a confirmed-working integration of the Delta Dore Tydom 1.0 gateway (also sold as "Tydom Home", retail SKU 6700105, hardware reference 25170010) with [Homey Pro](https://homey.app/).**
>
> **Tested in production against real hardware** — Tybox thermostats pair, state reads, control writes, boost (setpoint derogation), alarms, mode changes all work on firmware 03.22.42.
>
> **Scope note**: production testing focused on **Tybox thermostats**. The TYXIA light driver is shipped and re-enabled from 1.0.4 onwards but was not validated against real TYXIA receivers in this fork — bug reports from TYXIA owners are very welcome. Shutters, alarms, plugs, and door sensors are not implemented yet.
>
> Not tested against Tydom 2.0 — that's a different, cloud-first product with a completely different API and this app will NOT work with it.

A local integration that exposes your Delta Dore Tybox thermostats and X3D lights as native Homey devices. All control runs on your LAN; the Delta Dore cloud is only contacted once, if you choose to import your gateway with your Tydom app account during setup.

This is a **fork of [evenh/net.evenh.tydom](https://github.com/evenh/net.evenh.tydom)** with fixes and new features needed to actually run on current Homey firmware and against the Tydom 1.0 gateway.

## What this fork adds

- **Fixes TypeScript compile failure** — upstream won't install as-is (duplicate `logger` declaration).
- **Fixes TLS connection to the Tydom gateway** — Tydom 1.0 speaks pre-RFC5746 TLS which modern Node rejects as "unsafe legacy renegotiation disabled". The app now opts in to `SSL_OP_LEGACY_SERVER_CONNECT` globally.
- **Removes the blocking debugger-wait** that caused the app to hang during `onInit` (and therefore the pair screen to spin forever).
- **Setup from the add-device screen** — Homey finds the Tydom on your network by itself (MAC discovery), then you connect it by briefly pressing the gateway's button (fully local, no account) or by signing in with your Tydom app account (the account password is used once and never stored). No IP to type, no restart.
- **Self-healing connections** — gateways reconnect automatically, follow IP changes, and devices show why they're unavailable.
- **Multiple gateways** — add as many Tydom gateways as you like (e.g. home + holiday house), each with its own name; the app settings show each gateway's live status.
- **Thermostat mode capability** — heat / cool / auto / off, mapped to the Tydom `authorization` field.
- **Boost (force on)** — exposed as an `onoff.boost` toggle. Implemented as a Tydom setpoint derogation (since the nominal `boostOn` field is silently ignored on Tybox models). Boost ON → setpoint forced to 30 °C (heating) or 10 °C (cooling) for effectively unlimited time; Boost OFF cancels the derogation.
- **Alarms**: `alarm_battery` (battery fault on the remote command unit), `alarm_generic.production` (generic production fault), `alarm_generic.sensor` (any of three sensor-fault flags). All auto-usable as Homey flow triggers and conditions.
- **Initial-state seeding** — when a device is paired or Homey restarts, the current temperature / setpoint / mode / fault state is fetched immediately instead of waiting for the Tydom to push an update.
- **Local test harness** (`tydom-test/`) — standalone scripts to connect, list endpoints, dump device data, test boost sequences. Useful when debugging without reinstalling the Homey app each iteration.

## Requirements

- Homey Pro (any generation, SDK v3 compatible)
- Delta Dore Tydom 1.0 gateway on the same LAN
- Your Tydom mobile app login (recommended), or the gateway sticker password

## Installation

Install **Delta Dore Tydom** from the [Homey App Store](https://homey.app/a/com.jogoossens.tydom/). A test version with the latest changes may be available at [homey.app/a/com.jogoossens.tydom/test](https://homey.app/a/com.jogoossens.tydom/test/).

Developers can install from source with the Homey CLI instead — see [Development](#development).

## Setup

1. In Homey, go to **Devices → + → Delta Dore Tydom** and pick **Thermostat** or **Light**.
2. The first time, Homey looks for your Tydom on your network and shows what it found. Connect it one of these ways:
   - **Press the button on your Tydom** — tap **Start**, then briefly press the button next to the Tydom's power cable (about half a second). No account needed. **Don't hold it**: holding it for ~15 seconds factory-resets the gateway.
   - **Sign in with your Tydom app account** — the email and password of the Tydom mobile app. The app fetches the gateway password from Delta Dore; your account password is not stored.
   - **Use the password from the sticker** on the back of the Tydom.
3. Your thermostats / lights appear — tick the ones you want. Adding more devices later skips step 2.

The app settings (**Settings → Apps → Delta Dore Tydom → Configure app**) show each gateway's live status, let you name gateways (shown after device names when you have several, e.g. "Thermostat · Holiday house"), import all gateways of your account at once, or remove one. Changes apply immediately.

Tip: close the Tydom app on your phone while setting up. The gateway accepts only one local connection at a time.

### Manual setup (normally not needed)

If the gateway isn't found automatically (e.g. it's on a different network segment than Homey), open the app settings, tap **Add gateway manually** and fill in:

- **Hostname / IP** — the local IP of the Tydom gateway
- **MAC address** — the 12-char hex string on the gateway sticker, uppercase, no separators (e.g. `001A25XXXXXX`)
- **Gateway password** — the password printed on the gateway sticker. It's **not** your Delta Dore account password and **not** derivable from the MAC.

If the sticker is missing or unreadable:

- **Recover it from the Delta Dore cloud** — this is what the account import does for you. To do it by hand (Azure AD B2C / ROPC):

  ```bash
  EMAIL="your-deltadore-account@example.com"
  PASS='your-deltadore-account-password'
  MAC="001A25XXXXXX"
  CID="8782839f-3264-472a-ab87-4d4e23524da4"
  SCOPE="openid profile offline_access https://deltadoreadb2ciot.onmicrosoft.com/iotapi/sites_management_gateway_credentials"

  TOKEN_EP=$(curl -sS "https://deltadoreadb2ciot.b2clogin.com/deltadoreadb2ciot.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_AccountProviderROPC_SignIn" | jq -r .token_endpoint)

  ACCESS=$(curl -sS -X POST "$TOKEN_EP" \
    -F "username=$EMAIL" -F "password=$PASS" \
    -F "grant_type=password" -F "client_id=$CID" -F "scope=$SCOPE" | jq -r .access_token)

  curl -sS "https://prod.iotdeltadore.com/sitesmanagement/api/v1/sites?gateway_mac=$MAC" \
    -H "Authorization: Bearer $ACCESS" | jq -r '.sites[0].gateway.password'
  ```

  The gateway password contains shell-special characters (`&`, `$`, `+`, …). Use single quotes when pasting it.

- **Factory reset** — hold the button next to the power cable on the Tydom for ~15 s until the LED flashes fast violet, then set a new password from the Tydom mobile app. This may force re-pairing of X3D devices.

## Supported devices

### Thermostats (Tybox family)

Every Tybox thermostat exposed by your Tydom becomes one Homey device with:

| Homey capability | Tydom field | Notes |
|---|---|---|
| `measure_temperature` | `temperature` | Current room temp |
| `target_temperature` | `setpoint` | Read + write, 10–30 °C |
| `thermostat_mode` | `authorization` | heat / cool / auto / off |
| `onoff` | `hvacMode` | Master on/off (NORMAL vs STOP) |
| `onoff.boost` | `tempoOn` (driven via setpoint derogation) | Force the thermostat full-tilt regardless of current temp; stays on until you toggle it off |
| `alarm_battery` | `batteryCmdDefect` | Battery fault on the remote command unit |
| `alarm_generic.production` | `productionDefect` | Generic production fault |
| `alarm_generic.sensor` | OR of `tempSensor{Defect,ShortCut,OpenCirc}` | Any temperature sensor fault |

### Lights

Dimmable X3D lights (TYXIA series). Exposed as Homey devices with `onoff` and `dim` capabilities. Values are seeded on init and updated on Tydom push notifications.

## Known limitations

- **`boostOn` is silently ignored by Tybox thermostats** despite the metadata claiming it's read-write. This app works around it by using the setpoint-derogation mechanism instead, which is what the Tydom mobile app itself uses internally.
- **PI regulator parameters are not exposed** by the Tydom API. You can't change P / I / D or the anticipation coefficient from Homey — only read `anticipCoeff`.
- **Master / follower zone relationships between thermostats are not visible** via the API. If you have a pair of Tyboxes where one follows the other via X3D binding, Homey will show them as two independent devices; writes to the follower may silently have no physical effect.
- **X3D receivers (multikits, 8-channel modules) are invisible** to the Tydom HTTP API. They're commanded by the thermostats over X3D radio directly; the gateway is not in the loop. You cannot control them from Homey through this app.
- **Only lights and thermostats are implemented.** Shutters, alarms, plugs, door sensors, etc. are not yet supported even though the upstream Tydom protocol has metadata for them.
- **Automatic discovery needs Homey and the Tydom on the same network segment** (it finds the gateway by its Delta Dore MAC prefix `00:1A:25`). Otherwise enter the IP in the app settings.
- **Tydom 1.0 accepts one local connection at a time.** The Tydom mobile app on your Wi-Fi, a second Homey, or another integration talking to the same gateway will compete with this app.

## Local test harness

Standalone Node scripts under `tydom-test/` that talk to the gateway directly, without involving Homey. Useful when debugging the gateway side.

Configure credentials **once**, one of two ways:

```bash
# Option 1: environment variables
export TYDOM_HOST=192.168.1.50
export TYDOM_USER=001A25XXXXXX
export TYDOM_PASS='your-sticker-password'

# Option 2: copy .env.example → .env.json (gitignored) and fill in
cp tydom-test/.env.example tydom-test/.env.json
$EDITOR tydom-test/.env.json
```

Then run any of:

```bash
node tydom-test/test-connect.js       # connect, ping, list endpoints, observe push updates
node tydom-test/test-device-data.js   # dump full data payload for every endpoint
node tydom-test/test-full-scan.js     # probe hidden endpoints, dump meta/config/moments
DEVICE=<deviceId> node tydom-test/test-boost.js   # test boost semantics on one thermostat
```

Device-specific scripts (`test-boost*.js`, `test-probe-hidden.js`, `test-restore-thermostat.js`) take the device id from `DEVICE` (and `ENDPOINT`, defaulting to the same id) — list ids with `test-connect.js`.

Silence the verbose `tydom-client` wire log by setting `DEBUG=` empty. Nothing is hardcoded in the scripts — all credentials and device ids come from env vars or `.env.json`.

## Development

Requires Node.js 18+ and the [Homey CLI](https://apps.developer.homey.app/getting-started/your-first-app/cli-reference).

```bash
git clone https://github.com/jogoossens/net.evenh.tydom.git
cd net.evenh.tydom
npm install
npm run build        # tsc type-check
homey app install    # push to your Homey Pro
homey app run        # tail live logs from the app
```

`app.json` is auto-generated from `.homeycompose/app.json` and the per-driver `driver.compose.json` files — edit those, not the generated file.

## Credits

- Upstream project: [evenh/net.evenh.tydom](https://github.com/evenh/net.evenh.tydom) by Even Holthe.
- Local Tydom protocol client: [mgcrea/tydom-client](https://github.com/mgcrea/tydom-client) by Olivier Louvignes.
- Protocol research: [CyrilP/hass-deltadore-tydom-component](https://github.com/CyrilP/hass-deltadore-tydom-component) (authoritative reference for the Azure AD B2C password-recovery flow and raw Tydom frame captures).
- Homebridge plugin that pioneered much of the Tydom mapping: [mgcrea/homebridge-tydom](https://github.com/mgcrea/homebridge-tydom).

## License

Same as upstream (see `LICENSE`).

## Disclaimer

Not affiliated with or endorsed by Delta Dore. Use at your own risk. This app disables TLS certificate verification for the Tydom connection (the gateway uses a self-signed cert), so only run it on a trusted LAN. The optional Delta Dore account import talks to Delta Dore's own servers with normal certificate checks.
