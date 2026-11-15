import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceService, toConnectionStatus } from './device.service';

describe('toConnectionStatus', () => {
  it('normalises the states reported by the device library', () => {
    expect(toConnectionStatus('UPDATING')).toBe('updating');
    expect(toConnectionStatus('ERROR')).toBe('error');
    expect(toConnectionStatus('offline')).toBe('offline');
    expect(toConnectionStatus('MQTT_CONNECTED')).toBe('online');
    expect(toConnectionStatus(undefined)).toBe('online');
  });
});

describe('DeviceService presence', () => {
  let service: DeviceService;
  let upsert: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      device: { upsert, findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const config = { getOrThrow: () => 90_000 } as unknown as ConfigService;
    service = new DeviceService(prisma, config);
  });

  afterEach(() => jest.useRealTimers());

  const heartbeat = (status = 'MQTT_CONNECTED') =>
    service.onStatus({
      deviceId: 'esp_1',
      payload: {
        status,
        ip: '10.0.0.5',
        rssi: -60,
        uptime: 5,
        free_heap: 1000,
      },
    });

  it('creates the device on its first heartbeat and tracks its telemetry', async () => {
    await heartbeat();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(await service.getStatus('esp_1')).toMatchObject({
      status: 'online',
      ip: '10.0.0.5',
      rssi: -60,
      freeHeap: 1000,
    });
  });

  it('does not write to the database on every heartbeat', async () => {
    await heartbeat();
    jest.advanceTimersByTime(30_000);
    await heartbeat();
    expect(upsert).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31_000);
    await heartbeat();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('marks silent devices offline and brings them back on a heartbeat', async () => {
    await heartbeat();
    jest.advanceTimersByTime(89_000);
    service.markStaleDevicesOffline();
    expect(service.isOnline('esp_1')).toBe(true);

    jest.advanceTimersByTime(2_000);
    service.markStaleDevicesOffline();
    expect(service.isOnline('esp_1')).toBe(false);

    await heartbeat();
    expect(service.isOnline('esp_1')).toBe(true);
  });

  it('treats the last will as offline without refreshing lastSeen', async () => {
    await heartbeat();
    const { lastSeen } = await service.getStatus('esp_1');
    jest.advanceTimersByTime(5_000);
    await heartbeat('offline');

    const status = await service.getStatus('esp_1');
    expect(status.status).toBe('offline');
    expect(status.lastSeen).toEqual(lastSeen);
  });

  it('ignores malformed telemetry values', async () => {
    await service.onStatus({
      deviceId: 'esp_1',
      payload: { rssi: 'strong', uptime: null } as never,
    });
    expect(await service.getStatus('esp_1')).toMatchObject({
      rssi: null,
      uptime: null,
    });
  });

  it('reports unknown devices as not found', async () => {
    await expect(service.getStatus('ghost')).rejects.toThrow(NotFoundException);
  });
});
