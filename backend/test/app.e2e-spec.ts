/**
 * End-to-end suite: boots the real application against PostgreSQL, an MQTT
 * broker and S3 storage, and plays the part of an ESP32 over MQTT.
 *
 *   docker compose up -d postgres mosquitto s3
 *   DATABASE_URL=postgresql://roidota:roidota@localhost:5432/roidota npx prisma migrate deploy
 *   npm run test:e2e
 *
 * See test/e2e-env.ts for the connection settings and how to override them.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'crypto';
import * as mqtt from 'mqtt';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DeploymentService } from '../src/deployment/deployment.service';
import { PrismaService } from '../src/prisma/prisma.service';

const API_KEY = process.env.API_KEY!;
const RUN = randomBytes(3).toString('hex');
const DEVICE = `e2e-${RUN}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(
  check: () => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(50);
    }
  }
}

/** A fake ESP image: the 0xE9 magic byte followed by random content. */
const firmwareImage = (size = 4096) =>
  Buffer.concat([Buffer.from([0xe9]), randomBytes(size - 1)]);

/** Minimal stand-in for the RoidOTA device library. */
class FakeDevice {
  readonly offers: any[] = [];
  readonly commands: any[] = [];
  private constructor(
    readonly id: string,
    private readonly client: mqtt.MqttClient,
  ) {}

  static async connect(id: string): Promise<FakeDevice> {
    const client = await mqtt.connectAsync(
      `mqtt://${process.env.MQTT_BROKER}:${process.env.MQTT_PORT}`,
      {
        clientId: id,
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
      },
    );
    const device = new FakeDevice(id, client);
    client.on('message', (topic, payload) => {
      const message = JSON.parse(payload.toString());
      if (topic.startsWith('roidota/response/')) device.offers.push(message);
      else device.commands.push(message);
    });
    await client.subscribeAsync([
      `roidota/response/${id}`,
      `roidota/cmd/${id}`,
    ]);
    return device;
  }

  private publish(topic: string, body: object) {
    return this.client.publishAsync(topic, JSON.stringify(body), { qos: 1 });
  }

  announce(extra: object = {}) {
    return this.publish('roidota/request', {
      device_id: this.id,
      ip: '10.0.0.42',
      protocol: 2,
      firmware_id: null,
      ...extra,
    });
  }

  heartbeat(status = 'MQTT_CONNECTED') {
    return this.publish(`roidota/status/${this.id}`, {
      device_id: this.id,
      ip: '10.0.0.42',
      rssi: -51,
      uptime: 1234,
      free_heap: 200000,
      status,
    });
  }

  ack(body: object) {
    return this.publish(`roidota/ack/${this.id}`, {
      device_id: this.id,
      ...body,
    });
  }

  async nextOffer(): Promise<any> {
    const seen = this.offers.length;
    return eventually(() => {
      if (this.offers.length <= seen) throw new Error('no firmware offer');
      return Promise.resolve(this.offers[this.offers.length - 1]);
    });
  }

  close() {
    return this.client.endAsync();
  }
}

describe('RoidOTA backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let device: FakeDevice;

  const api = () => request(app.getHttpServer());
  const get = (path: string) => api().get(path).set('X-API-Key', API_KEY);
  const post = (path: string) => api().post(path).set('X-API-Key', API_KEY);
  const del = (path: string) => api().delete(path).set('X-API-Key', API_KEY);

  const upload = (name: string, version: string, image = firmwareImage()) =>
    post('/firmware/upload/bin')
      .field('firmwareName', name)
      .field('version', version)
      .attach('userCode', image, 'firmware.bin');

  const deploymentStatus = async (id: string) =>
    (await get(`/firmware/deployments/${id}`).expect(200)).body.deployment;

  const expectStatus = (id: string, status: string) =>
    eventually(async () => {
      const deployment = await deploymentStatus(id);
      expect(deployment.status).toBe(status);
      return deployment;
    });

  let fwA: any;
  let fwB: any;
  const imageA = firmwareImage();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await eventually(() => api().get('/health').expect(200), 10_000);
    device = await FakeDevice.connect(DEVICE);
  });

  afterAll(async () => {
    await device?.close();
    await app?.close();
  });

  describe('authentication', () => {
    it('serves the health check without a key', async () => {
      const { body } = await api().get('/health').expect(200);
      expect(body.checks).toEqual({
        database: 'up',
        mqtt: 'up',
        storage: 'up',
      });
    });

    it('rejects requests without or with a wrong key', async () => {
      await api().get('/firmware').expect(401);
      await api().get('/firmware').set('X-API-Key', 'wrong').expect(401);
    });

    it('accepts the key as a bearer token', async () => {
      await api()
        .get('/firmware')
        .set('Authorization', `Bearer ${API_KEY}`)
        .expect(200);
    });
  });

  describe('firmware', () => {
    it('rejects missing, empty-named and non-firmware uploads', async () => {
      await post('/firmware/upload/bin').field('firmwareName', 'x').expect(400);
      await upload('../evil', '1.0.0').expect(400);
      await upload(`app-${RUN}`, '1.0.0', Buffer.from('not firmware')).expect(
        400,
      );
    });

    it('stores an upload with integrity metadata and a working URL', async () => {
      const { body } = await upload(`app-${RUN}`, '1.0.0', imageA).expect(201);
      fwA = body.firmware;
      expect(fwA).toMatchObject({
        name: `app-${RUN}`,
        version: '1.0.0',
        size: imageA.length,
        md5: createHash('md5').update(imageA).digest('hex'),
        sha256: createHash('sha256').update(imageA).digest('hex'),
      });

      const download = await fetch(fwA.s3Url);
      expect(download.status).toBe(200);
      expect(Buffer.from(await download.arrayBuffer()).equals(imageA)).toBe(
        true,
      );
    });

    it('refuses anonymous access to the stored object', async () => {
      const unsigned = fwA.s3Url.split('?')[0];
      expect((await fetch(unsigned)).status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a duplicate name and version', async () => {
      await upload(`app-${RUN}`, '1.0.0').expect(409);
    });

    it('lists uploaded firmware', async () => {
      fwB = (await upload(`app-${RUN}`, '2.0.0').expect(201)).body.firmware;
      const { body } = await get('/firmware').expect(200);
      const ids = body.firmware.map((f: any) => f.id);
      expect(ids).toEqual(expect.arrayContaining([fwA.id, fwB.id]));
    });
  });

  describe('devices', () => {
    it('registers a device when it announces itself', async () => {
      await device.announce();
      await eventually(async () => {
        const { body } = await get('/firmware/devices').expect(200);
        const found = body.devices.find((d: any) => d.deviceId === DEVICE);
        expect(found).toMatchObject({
          ip: '10.0.0.42',
          connectionStatus: 'online',
          currentFirmware: null,
        });
        expect(found.lastSeen).toBeTruthy();
      });
    });

    it('tracks heartbeats, including upper-case device states', async () => {
      await device.heartbeat();
      await eventually(async () => {
        const { body } = await get(`/firmware/device/${DEVICE}/status`).expect(
          200,
        );
        expect(body).toMatchObject({
          status: 'online',
          rssi: -51,
          uptime: 1234,
        });
      });

      await device.heartbeat('ERROR');
      await eventually(async () => {
        const { body } = await get(`/firmware/device/${DEVICE}/status`).expect(
          200,
        );
        expect(body.status).toBe('error');
      });
      await device.heartbeat();
    });

    it('returns 404 for unknown devices and 400 for malformed IDs', async () => {
      await get('/firmware/device/nobody/status').expect(404);
      await get('/firmware/device/nobody/current-firmware').expect(404);
      await del('/firmware/device/nobody').expect(404);
      await get('/firmware/device/bad+id/status').expect(400);
    });

    it('delivers commands to the device', async () => {
      await post(`/firmware/device/${DEVICE}/restart`).expect(200);
      await eventually(() => {
        expect(device.commands.at(-1)).toMatchObject({ command: 'restart' });
        return Promise.resolve();
      });
      await post(`/firmware/device/${DEVICE}/command`)
        .send({ command: 'DROP TABLE' })
        .expect(400);
    });
  });

  describe('deployments', () => {
    it('validates the target and the firmware', async () => {
      await post('/firmware/deploy/nobody')
        .send({ firmwareId: fwA.id })
        .expect(404);
      await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
      await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: 'nope' })
        .expect(400);
      await post('/firmware/deploy/batch')
        .send({ firmwareId: fwA.id, devices: [] })
        .expect(400);
    });

    it('runs a full update: offer, in progress, acknowledged', async () => {
      const offerPromise = device.nextOffer();
      const { body } = await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: fwA.id })
        .expect(201);
      expect(body).toMatchObject({ status: 'pending', deviceId: DEVICE });

      const offer = await offerPromise;
      expect(offer).toMatchObject({
        device_id: DEVICE,
        deployment_id: body.deploymentId,
        firmware_id: fwA.id,
        md5: fwA.md5,
        size: imageA.length,
        current_firmware: 'unknown',
      });
      const binary = Buffer.from(
        await (await fetch(offer.firmware_url)).arrayBuffer(),
      );
      expect(createHash('md5').update(binary).digest('hex')).toBe(offer.md5);

      await device.heartbeat('UPDATING');
      await expectStatus(body.deploymentId, 'IN_PROGRESS');

      await device.ack({ success: true, deployment_id: body.deploymentId });
      const done = await expectStatus(body.deploymentId, 'SUCCESS');
      expect(done.completedAt).toBeTruthy();

      const current = await get(
        `/firmware/device/${DEVICE}/current-firmware`,
      ).expect(200);
      expect(current.body.currentFirmware).toMatchObject({
        id: fwA.id,
        version: '1.0.0',
      });
    });

    it('ignores a duplicate ack', async () => {
      const before = await get('/firmware/deployments/history').expect(200);
      await device.ack({ success: false, message: 'late duplicate' });
      await sleep(300);
      const after = await get('/firmware/deployments/history').expect(200);
      expect(after.body.deployments).toEqual(before.body.deployments);
    });

    it('records a failure reported by a legacy device (no deployment ID)', async () => {
      const offerPromise = device.nextOffer();
      const { body } = await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: fwB.id })
        .expect(201);
      await offerPromise;
      await device.ack({ success: false, message: 'Not enough space' });

      const failed = await expectStatus(body.deploymentId, 'FAILED');
      expect(failed.errorMessage).toBe('Not enough space');
      const current = await get(
        `/firmware/device/${DEVICE}/current-firmware`,
      ).expect(200);
      expect(current.body.currentFirmware.id).toBe(fwA.id);
    });

    it('supersedes an unfinished deployment with a newer one', async () => {
      const first = await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: fwB.id })
        .expect(201);
      const second = await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: fwB.id })
        .expect(201);

      const superseded = await expectStatus(first.body.deploymentId, 'FAILED');
      expect(superseded.errorMessage).toMatch(/superseded/i);

      const pending = await get('/firmware/deployments/pending').expect(200);
      const mine = pending.body.pending.filter(
        (p: any) => p.deviceId === DEVICE,
      );
      expect(mine.map((p: any) => p.id)).toEqual([second.body.deploymentId]);
    });

    it('re-sends a pending offer when the device reconnects', async () => {
      const pending = await get('/firmware/deployments/pending').expect(200);
      const mine = pending.body.pending.find((p: any) => p.deviceId === DEVICE);

      const offerPromise = device.nextOffer();
      await device.announce({ firmware_id: fwA.id });
      expect(await offerPromise).toMatchObject({
        deployment_id: mine.id,
        firmware_id: fwB.id,
        current_firmware: '1.0.0',
      });
    });

    it('confirms a deployment when the device comes back on the new firmware', async () => {
      const pending = await get('/firmware/deployments/pending').expect(200);
      const mine = pending.body.pending.find((p: any) => p.deviceId === DEVICE);

      // The ack was lost; the device rebooted and reports the new firmware.
      await device.announce({ firmware_id: fwB.id });
      await expectStatus(mine.id, 'SUCCESS');
      const current = await get(
        `/firmware/device/${DEVICE}/current-firmware`,
      ).expect(200);
      expect(current.body.currentFirmware.id).toBe(fwB.id);
    });

    it('fails an in-progress deployment when the device reboots on the old firmware', async () => {
      const { body } = await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: fwA.id })
        .expect(201);
      await device.heartbeat('UPDATING');
      await expectStatus(body.deploymentId, 'IN_PROGRESS');

      await device.announce({ firmware_id: fwB.id });
      const failed = await expectStatus(body.deploymentId, 'FAILED');
      expect(failed.errorMessage).toMatch(/restarted/i);
    });

    it('rolls back to the previous successful firmware', async () => {
      const offerPromise = device.nextOffer();
      const { body } = await post(`/firmware/device/${DEVICE}/rollback`).expect(
        201,
      );
      expect(body.firmware.id).toBe(fwA.id);
      expect((await offerPromise).firmware_id).toBe(fwA.id);

      await device.ack({ success: true, deployment_id: body.deploymentId });
      await expectStatus(body.deploymentId, 'SUCCESS');
    });

    it('times out deployments that never get a result', async () => {
      const { body } = await post(`/firmware/deploy/${DEVICE}`)
        .send({ firmwareId: fwB.id })
        .expect(201);
      await prisma.firmwareHistory.update({
        where: { id: body.deploymentId },
        data: { appliedAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
      await app.get(DeploymentService).timeOutStaleDeployments();
      await expectStatus(body.deploymentId, 'TIMEOUT');

      // A late ack that names the deployment still counts.
      await device.ack({ success: true, deployment_id: body.deploymentId });
      await expectStatus(body.deploymentId, 'SUCCESS');
    });

    it('reports per-device results for batch deployments', async () => {
      const { body } = await post('/firmware/deploy/batch')
        .send({ firmwareId: fwA.id, devices: [DEVICE, 'ghost-device', DEVICE] })
        .expect(201);
      expect(body).toMatchObject({
        status: 'completed',
        successful: 1,
        failed: 1,
      });
      expect(body.results).toEqual([
        expect.objectContaining({ deviceId: DEVICE, status: 'fulfilled' }),
        {
          deviceId: 'ghost-device',
          status: 'rejected',
          reason: { statusCode: 404, message: 'Device ghost-device not found' },
        },
      ]);
      await device.ack({ success: true });
      await expectStatus(body.results[0].value.deploymentId, 'SUCCESS');
    });

    it('uploads and deploys in one request, registering new targets', async () => {
      const newcomer = `e2e-new-${RUN}`;
      const offerPromise = device.nextOffer();
      const { body } = await post('/firmware/upload/deploy/bin')
        .field('firmwareName', `app-${RUN}`)
        .field('version', '3.0.0')
        .field('targetDevices', JSON.stringify([DEVICE, newcomer]))
        .field('autoDeploy', 'true')
        .attach('userCode', firmwareImage(), 'firmware.bin')
        .expect(201);

      expect(body.deployment).toMatchObject({ successful: 2, failed: 0 });
      expect((await offerPromise).firmware_id).toBe(body.firmware.id);
      await device.ack({ success: true });

      const { body: history } = await get(
        `/firmware/device/${DEVICE}/history`,
      ).expect(200);
      expect(history.history[0]).toMatchObject({
        firmware: { version: '3.0.0' },
      });
      await eventually(async () => {
        const latest = await get(`/firmware/device/${DEVICE}/history`).expect(
          200,
        );
        expect(latest.body.history[0].status).toBe('SUCCESS');
      });
    });
  });

  describe('cleanup rules', () => {
    it('marks the device offline on its last will', async () => {
      await device.heartbeat('offline');
      await eventually(async () => {
        const { body } = await get('/firmware/device/statuses').expect(200);
        expect(body.find((s: any) => s.deviceId === DEVICE).status).toBe(
          'offline',
        );
      });
    });

    it('refuses to delete firmware that is running or being deployed', async () => {
      const { body } = await get(
        `/firmware/device/${DEVICE}/current-firmware`,
      ).expect(200);
      await del(`/firmware/${body.currentFirmware.id}`).expect(409);
    });

    it('deletes devices together with their history', async () => {
      await del(`/firmware/device/${DEVICE}`).expect(200);
      await del(`/firmware/device/e2e-new-${RUN}`).expect(200);
      await get(`/firmware/device/${DEVICE}/status`).expect(404);
    });

    it('deletes unused firmware from the database and from storage', async () => {
      const { body } = await get('/firmware').expect(200);
      const mine = body.firmware.filter((f: any) => f.name === `app-${RUN}`);
      expect(mine).toHaveLength(3);

      for (const firmware of mine) {
        await del(`/firmware/${firmware.id}`).expect(200);
        expect((await fetch(firmware.s3Url)).status).toBe(404);
      }
      await del(`/firmware/${mine[0].id}`).expect(404);
    });
  });
});
