import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEVICE_EVENTS,
  DeviceEvent,
  DeviceLogMessage,
  DeviceRequestMessage,
  DeviceStatusMessage,
} from '../mqtt/mqtt.protocol';

export type ConnectionStatus = 'online' | 'offline' | 'error' | 'updating';

export interface DeviceStatus {
  deviceId: string;
  status: ConnectionStatus;
  ip: string | null;
  rssi: number | null;
  uptime: number | null;
  freeHeap: number | null;
  lastSeen: Date | null;
}

/** How often a heartbeat is allowed to touch the database, per device. */
const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000;

const firmwareSummary = (
  firmware: { id: string; name: string; version: string } | null,
) =>
  firmware
    ? { id: firmware.id, name: firmware.name, version: firmware.version }
    : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : null;

/** The device reports upper-case states ("UPDATING"); normalise them. */
export function toConnectionStatus(reported: unknown): ConnectionStatus {
  switch (typeof reported === 'string' ? reported.toLowerCase() : '') {
    case 'updating':
      return 'updating';
    case 'error':
      return 'error';
    case 'offline': // published by the broker as the device's last will
      return 'offline';
    default:
      return 'online';
  }
}

/**
 * Device registry: the database holds the durable device list, while live
 * presence (rssi, uptime, online/offline) is tracked in memory from heartbeats.
 */
@Injectable()
export class DeviceService implements OnModuleInit {
  private readonly logger = new Logger(DeviceService.name);
  private readonly statuses = new Map<string, DeviceStatus>();
  private readonly lastPersisted = new Map<string, number>();
  private readonly offlineAfterMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.offlineAfterMs = config.getOrThrow<number>('devices.offlineAfterMs');
  }

  /** Known devices start as offline so they are listed before they report in. */
  async onModuleInit() {
    const devices = await this.prisma.device.findMany();
    for (const device of devices) {
      this.statuses.set(device.deviceId, {
        deviceId: device.deviceId,
        status: 'offline',
        ip: device.ip,
        rssi: null,
        uptime: null,
        freeHeap: null,
        lastSeen: device.lastSeen,
      });
    }
  }

  // ---------------------------------------------------------------- queries

  async listDevices() {
    const devices = await this.prisma.device.findMany({
      include: { currentFirmware: true },
      orderBy: [
        { lastSeen: { sort: 'desc', nulls: 'last' } },
        { deviceId: 'asc' },
      ],
    });

    return {
      status: 'success',
      devices: devices.map((device) => ({
        id: device.id,
        deviceId: device.deviceId,
        ip: device.ip,
        connectionStatus:
          this.statuses.get(device.deviceId)?.status ?? 'offline',
        currentFirmware: firmwareSummary(device.currentFirmware),
        createdAt: device.createdAt,
        lastSeen: device.lastSeen,
        // Kept for existing clients, which read the last activity from here.
        updatedAt: device.lastSeen,
      })),
    };
  }

  async getStatuses() {
    const devices = await this.prisma.device.findMany({
      include: { currentFirmware: true },
    });
    const firmwareByDevice = new Map(
      devices.map((d) => [d.deviceId, firmwareSummary(d.currentFirmware)]),
    );

    return Array.from(this.statuses.values()).map((status) => ({
      ...status,
      currentFirmware: firmwareByDevice.get(status.deviceId) ?? null,
    }));
  }

  async getStatus(deviceId: string) {
    const status = this.statuses.get(deviceId);
    if (!status) throw new NotFoundException(`Device ${deviceId} not found`);

    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { currentFirmware: true },
    });
    return {
      ...status,
      currentFirmware: firmwareSummary(device?.currentFirmware ?? null),
    };
  }

  async getCurrentFirmware(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { currentFirmware: true },
    });
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);

    const firmware = device.currentFirmware;
    return {
      status: 'success',
      deviceId: device.deviceId,
      currentFirmware: firmware
        ? {
            id: firmware.id,
            name: firmware.name,
            version: firmware.version,
            uploadedAt: firmware.uploadedAt,
          }
        : null,
    };
  }

  isOnline(deviceId: string): boolean {
    const status = this.statuses.get(deviceId)?.status;
    return status !== undefined && status !== 'offline';
  }

  // -------------------------------------------------------------- mutations

  /** Registers a device ahead of its first connection (idempotent). */
  async register(deviceId: string) {
    const device = await this.prisma.device.upsert({
      where: { deviceId },
      update: {},
      create: { deviceId },
    });
    if (!this.statuses.has(deviceId)) {
      this.statuses.set(deviceId, {
        deviceId,
        status: 'offline',
        ip: device.ip,
        rssi: null,
        uptime: null,
        freeHeap: null,
        lastSeen: device.lastSeen,
      });
    }
    return device;
  }

  async deleteDevice(deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);

    // History rows reference the device, so they have to go first.
    await this.prisma.$transaction([
      this.prisma.firmwareHistory.deleteMany({
        where: { deviceId: device.id },
      }),
      this.prisma.device.delete({ where: { id: device.id } }),
    ]);
    this.statuses.delete(deviceId);
    this.lastPersisted.delete(deviceId);
    this.logger.log(`Deleted device ${deviceId}`);

    return {
      status: 'success',
      message: `Device ${deviceId} deleted successfully`,
    };
  }

  // ------------------------------------------------------------ MQTT events

  @OnEvent(DEVICE_EVENTS.REQUEST)
  async onRequest({ deviceId, payload }: DeviceEvent<DeviceRequestMessage>) {
    const ip = asString(payload.ip);
    await this.persistSeen(deviceId, ip);

    const previous = this.statuses.get(deviceId);
    this.statuses.set(deviceId, {
      deviceId,
      status: 'online',
      ip: ip ?? previous?.ip ?? null,
      rssi: previous?.rssi ?? null,
      uptime: previous?.uptime ?? null,
      freeHeap: previous?.freeHeap ?? null,
      lastSeen: new Date(),
    });
    this.logger.log(`Device ${deviceId} announced itself (${ip ?? 'no ip'})`);
  }

  @OnEvent(DEVICE_EVENTS.STATUS)
  async onStatus({ deviceId, payload }: DeviceEvent<DeviceStatusMessage>) {
    const status = toConnectionStatus(payload.status);
    const previous = this.statuses.get(deviceId);

    if (status === 'offline') {
      // Last will: the device is gone, so this does not count as "seen".
      if (previous && previous.status !== 'offline') {
        this.statuses.set(deviceId, { ...previous, status: 'offline' });
        this.logger.log(`Device ${deviceId} went offline (last will)`);
      }
      return;
    }

    const ip = asString(payload.ip);
    this.statuses.set(deviceId, {
      deviceId,
      status,
      ip: ip ?? previous?.ip ?? null,
      rssi: asNumber(payload.rssi),
      uptime: asNumber(payload.uptime),
      freeHeap: asNumber(payload.free_heap),
      lastSeen: new Date(),
    });

    const persistedAt = this.lastPersisted.get(deviceId) ?? 0;
    if (Date.now() - persistedAt >= LAST_SEEN_PERSIST_INTERVAL_MS) {
      await this.persistSeen(deviceId, ip);
    }
  }

  @OnEvent(DEVICE_EVENTS.LOG)
  onLog({ deviceId, payload }: DeviceEvent<DeviceLogMessage>) {
    const level = String(payload.level ?? 'INFO').toUpperCase();
    const line = `[${deviceId}] ${String(payload.message ?? '')}`;
    if (level === 'ERROR') this.logger.error(line);
    else if (level === 'WARN' || level === 'WARNING') this.logger.warn(line);
    else this.logger.log(line);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  markStaleDevicesOffline() {
    const now = Date.now();
    for (const status of this.statuses.values()) {
      if (status.status === 'offline' || !status.lastSeen) continue;
      const silentFor = now - status.lastSeen.getTime();
      if (silentFor > this.offlineAfterMs) {
        status.status = 'offline';
        this.logger.log(
          `Device ${status.deviceId} marked offline after ${Math.floor(silentFor / 1000)}s of silence`,
        );
      }
    }
  }

  /** Creates the device on first contact and records when it was last seen. */
  private async persistSeen(deviceId: string, ip: string | null) {
    const lastSeen = new Date();
    this.lastPersisted.set(deviceId, lastSeen.getTime());
    await this.prisma.device.upsert({
      where: { deviceId },
      update: { lastSeen, ...(ip ? { ip } : {}) },
      create: { deviceId, ip, lastSeen },
    });
  }
}
