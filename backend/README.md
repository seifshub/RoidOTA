# RoidOTA backend

NestJS service behind RoidOTA: REST API, MQTT bridge to the devices, firmware
storage and deployment tracking. Setup, configuration, the API and the
deployment lifecycle are documented in the [project README](../README.md).

```bash
cp .env.example .env
docker compose up -d --build            # full stack
# or, for development:
docker compose up -d postgres mosquitto s3
npm ci && npx prisma migrate deploy && npm run start:dev
```

Layout:

| Path | Responsibility |
| --- | --- |
| `src/mqtt/` | Broker connection and the wire protocol; turns device messages into events |
| `src/device/` | Device registry and live presence |
| `src/firmware/` | Firmware upload/list/delete and the HTTP controller |
| `src/deployment/` | Deployment state machine, rollback, timeouts |
| `src/s3/`, `src/prisma/` | Storage and database access |
| `src/common/` | API-key guard, device ID validation |
| `test/` | End-to-end suite with a simulated device |
