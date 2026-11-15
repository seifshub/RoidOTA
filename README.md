# RoidOTA

Over-the-air firmware updates for ESP32 fleets. You upload a compiled binary,
pick the devices, and RoidOTA delivers it over MQTT, verifies it on the device
and tracks every deployment to a final result.

| Part | Path | What it is |
| --- | --- | --- |
| Backend | [`backend/`](backend) | NestJS REST API. Stores firmware in S3-compatible storage, state in PostgreSQL, and talks to devices over MQTT. |
| CLI | [`cli/`](cli) | `roidota`, a Rust command-line client for the API. |
| Device library | [`lib/RoidOTA/`](lib/RoidOTA) | Arduino/PlatformIO library for ESP32. |
| Example sketch | [`examples/basic/`](examples/basic) | Minimal firmware using the library. |

```
                 REST (X-API-Key)                 MQTT                    HTTP(S)
 roidota CLI ───────────────────▶ backend ◀──────────────▶ ESP32 ◀──────────────── S3 storage
 web dashboard                    │    │     offers, acks,        signed firmware URL
                                  ▼    ▼     heartbeats
                            PostgreSQL  S3 storage
```

## Quick start

Requirements: Docker, plus Rust (for the CLI) and PlatformIO (for devices).

```bash
cd backend
cp .env.example .env
# Edit .env: set API_KEY, the S3 keys, and S3_PUBLIC_ENDPOINT to
# http://<this machine's LAN address>:9000 so devices can download firmware.
docker compose up -d --build
curl http://localhost:3000/health
```

Install and point the CLI at the server:

```bash
cargo install --path cli
roidota config set --server-url http://localhost:3000 --key <API_KEY>
roidota health
```

Flash a device once over USB (set `DEVICE_ID`, `MQTT_SERVER` and the MQTT
credentials in `examples/basic/platformio.ini` first):

```bash
pio run -d examples/basic -t upload
```

On first boot the device opens a `RoidOTA-<id>` WiFi access point; connect to
it to enter your WiFi credentials. From then on, updates go over the air:

```bash
pio run -d examples/basic                       # build a new version
roidota firmware upload examples/basic/.pio/build/esp32dev/firmware.bin \
    --name blink --fw-version 1.1.0 --deploy-to esp_1 --wait
```

## CLI

```
roidota health
roidota firmware list | upload <file> | delete <firmware>
roidota device   list | status [device] | history <device>
                 restart <device> | heartbeat <device> | command <device> <cmd>
                 rollback <device> | delete <device>
roidota deploy <firmware> <device>... [--wait]
roidota deployment list [--pending] | show <id> | wait <id>...
roidota config show | set | path
```

- `<firmware>` is a firmware ID, `name@version`, or just `name` (latest upload).
- `--wait` blocks until every device reports a result. Exit codes: `0` success,
  `1` error, `2` a deployment was rejected, failed or timed out - convenient in
  CI pipelines.
- `--json` prints machine-readable output for any command.
- Settings come from flags, then `ROIDOTA_URL` / `ROIDOTA_API_KEY`, then the
  config file (`roidota config path`).

## Backend

### Configuration

All settings are environment variables; see
[`backend/.env.example`](backend/.env.example) for the full list.

| Variable | Purpose |
| --- | --- |
| `API_KEY` | Required in production. Clients send it as `X-API-Key` or `Authorization: Bearer`. Only `/health` is public. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `MQTT_BROKER`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD` | Broker connection (or `MQTT_URL=mqtts://...` for TLS). |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME` | Firmware storage. The bucket is created on first start. |
| `S3_PUBLIC_ENDPOINT` | Base URL used in the download links sent to devices. Must be reachable from the device network. |
| `DEPLOYMENT_TIMEOUT_MS` | How long a deployment may stay unfinished (default 5 minutes). |
| `DEVICE_OFFLINE_AFTER_MS` | Silence after which a device is shown offline (default 90 s). |
| `SWAGGER_ENABLED` | Serves interactive API docs at `/api`. On in development, off in production. |

> If your shell already exports `DATABASE_URL` for another project, it takes
> precedence over `backend/.env`. Unset it before running the backend locally.

### Development

```bash
cd backend
npm ci
docker compose up -d postgres mosquitto s3     # infrastructure only
npx prisma migrate deploy
npm run start:dev

npm run lint
npm test                 # unit tests, no services needed
npm run test:e2e         # full flow against the services above, with a simulated device
```

### API

Existing routes are unchanged, so current clients keep working. All are under
`/firmware`:

| Method and path | Description |
| --- | --- |
| `GET /firmware` | List firmware |
| `POST /firmware/upload/bin` | Upload a binary (multipart field `userCode`, optional `firmwareName`, `version`) |
| `POST /firmware/upload/deploy/bin` | Upload and optionally deploy (`targetDevices`, `autoDeploy`) |
| `DELETE /firmware/:firmwareId` | Delete firmware that is not running on a device or being deployed |
| `POST /firmware/deploy/:deviceId` | Deploy `{ firmwareId }` to one device |
| `POST /firmware/deploy/batch` | Deploy `{ firmwareId, devices }` to several devices |
| `GET /firmware/deployments/history` \| `pending` \| `:deploymentId` | Deployment records |
| `GET /firmware/devices` | Registered devices |
| `GET /firmware/device/statuses` | Live status of all devices |
| `GET /firmware/device/:deviceId/status` \| `current-firmware` \| `history` | One device |
| `POST /firmware/device/:deviceId/rollback` | Redeploy the previous successful firmware |
| `POST /firmware/device/:deviceId/restart` \| `heartbeat` \| `command` | Send a command |
| `DELETE /firmware/device/:deviceId` | Delete a device and its history |
| `GET /health` | Health of the database, broker and storage (503 when degraded) |

A web dashboard build placed in `backend/public/` is served from `/`.

### Deployment lifecycle

```
PENDING ──(device reports "updating")──▶ IN_PROGRESS
   │                                         │
   └──────────────────┬──────────────────────┘
                      ▼
   SUCCESS   the device acknowledged, or came back running the new firmware
   FAILED    the device reported an error, rebooted without the update,
             or a newer deployment superseded this one
   TIMEOUT   no result within DEPLOYMENT_TIMEOUT_MS
```

- A device has at most one unfinished deployment; a new one supersedes it.
- If a device is offline, the deployment waits and is delivered when the
  device reconnects (until it times out).
- Every offer carries the firmware's MD5 and size; the device refuses an image
  that does not match and keeps running its current firmware.

## Device library

```cpp
#include <RoidOTA.h>

void userSetup() {
  RoidOTA::onMessage(handleMessage);     // your own MQTT messages
  RoidOTA::subscribe("user/esp/command");
}
void userLoop() { /* your non-blocking application code */ }

void setup() { RoidOTA::begin(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD, userSetup, userLoop); }
void loop()  { RoidOTA::handle(); }
```

Build flags: `DEVICE_ID`, `MQTT_SERVER`, `MQTT_PORT` (1883),
`HEARTBEAT_INTERVAL` (30000 ms). `RoidOTA::setServer()` and
`RoidOTA::setCACert()` (for `https://` firmware URLs) can be called before
`begin()`.

Device IDs may contain letters, digits, `_`, `-` and `.` (up to 64 characters).

### MQTT protocol (version 2)

| Topic | Direction | Payload |
| --- | --- | --- |
| `roidota/request` | device → server | `{ device_id, ip, protocol, firmware_id }` on every (re)connect |
| `roidota/status/<id>` | device → server | Heartbeat `{ status, ip, rssi, uptime, free_heap, firmware_id }`; the last will reports `offline` |
| `roidota/logs/<id>` | device → server | `{ level, message }` |
| `roidota/ack/<id>` | device → server | `{ success, message, deployment_id }` |
| `roidota/response/<id>` | server → device | Offer `{ deployment_id, firmware_id, firmware_url, md5, size, ... }` |
| `roidota/cmd/<id>` | server → device | `{ command, params }` - `restart`, `heartbeat`, `status` |

Devices running the 1.x library (no `protocol` field) still work: their
acknowledgement is matched to the device's single unfinished deployment. They
do not get redelivery after reconnecting or confirmation after reboot.

## Known limitations

- **MQTT is not encrypted and all devices share one broker account.** Any
  holder of the broker credentials can impersonate a device. For untrusted
  networks, put the broker behind TLS and give each device its own account
  with topic ACLs.
- **Firmware is not signed.** The MD5 check protects against corruption, not
  against someone who can publish offers on the broker.
- **No automatic rollback of a firmware that boots but misbehaves.** Use
  `roidota device rollback`, which needs the device to still reach the broker.
- **Live device status is held in memory** by a single backend instance; do
  not run several replicas behind a load balancer.
- **One API key** for all clients; there are no per-user accounts.

## License

[MIT](LICENSE)
