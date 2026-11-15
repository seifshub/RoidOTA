import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  DeploymentStatus,
  Device,
  Firmware,
  FirmwareHistory,
} from '@prisma/client';
import { DeviceService, toConnectionStatus } from '../device/device.service';
import { FirmwareService } from '../firmware/firmware.service';
import {
  DEVICE_EVENTS,
  DeviceAckMessage,
  DeviceEvent,
  DeviceRequestMessage,
  DeviceStatusMessage,
} from '../mqtt/mqtt.protocol';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';

/** A deployment the device has not reported a final result for yet. */
const ACTIVE: DeploymentStatus[] = ['PENDING', 'IN_PROGRESS'];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const firmwareSummary = (firmware: Firmware) => ({
  id: firmware.id,
  name: firmware.name,
  version: firmware.version,
});

type DeploymentWithRelations = FirmwareHistory & {
  firmware: Firmware;
  device: Device;
};

/**
 * Deployment lifecycle:
 *
 *   PENDING ──(device reports "updating")──▶ IN_PROGRESS
 *      │                                         │
 *      └──────────────┬──────────────────────────┘
 *                     ▼
 *     SUCCESS  (ack, or the device comes back running the new firmware)
 *     FAILED   (negative ack, superseded, or the device rebooted without it)
 *     TIMEOUT  (no result within DEPLOYMENT_TIMEOUT_MS)
 *
 * A device has at most one active deployment; starting a new one supersedes
 * the previous one, so an ack can never be attributed to the wrong firmware.
 */
@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly firmwareService: FirmwareService,
    private readonly deviceService: DeviceService,
    config: ConfigService,
  ) {
    this.timeoutMs = config.getOrThrow<number>('deployments.timeoutMs');
  }

  // ------------------------------------------------------------- deploying

  async deployToDevice(deviceId: string, firmwareId: string) {
    const [firmware, device] = await Promise.all([
      this.firmwareService.getOrThrow(firmwareId),
      this.prisma.device.findUnique({
        where: { deviceId },
        include: { currentFirmware: true },
      }),
    ]);
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);

    const deployment = await this.prisma.$transaction(async (tx) => {
      await tx.firmwareHistory.updateMany({
        where: { deviceId: device.id, status: { in: ACTIVE } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: 'Superseded by a newer deployment',
        },
      });
      return tx.firmwareHistory.create({
        data: { deviceId: device.id, firmwareId: firmware.id },
      });
    });

    try {
      await this.sendOffer(device, firmware, deployment.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.finish(deployment.id, 'FAILED', ACTIVE, reason);
      throw error;
    }

    const online = this.deviceService.isOnline(deviceId);
    this.logger.log(
      `Deployment ${deployment.id}: ${firmware.name} ${firmware.version} -> ${deviceId}` +
        (online
          ? ''
          : ' (device offline, will be delivered when it reconnects)'),
    );

    return {
      status: 'pending',
      message: online
        ? `Firmware deployment initiated for ${deviceId}`
        : `Device ${deviceId} is offline; the firmware will be delivered when it reconnects`,
      deviceId,
      deploymentId: deployment.id,
      firmware: firmwareSummary(firmware),
    };
  }

  async batchDeploy(deviceIds: string[], firmwareId: string) {
    // Fail the whole request up front rather than once per device.
    await this.firmwareService.getOrThrow(firmwareId);

    const uniqueIds = [...new Set(deviceIds)];
    const settled = await Promise.allSettled(
      uniqueIds.map((deviceId) => this.deployToDevice(deviceId, firmwareId)),
    );

    // Same shape as Promise.allSettled, but with serialisable failure reasons.
    const results = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? {
            deviceId: uniqueIds[index],
            status: 'fulfilled' as const,
            value: result.value,
          }
        : {
            deviceId: uniqueIds[index],
            status: 'rejected' as const,
            reason: this.describeError(result.reason),
          },
    );
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - successful;

    return {
      status: 'completed',
      message: `Deployment completed: ${successful} successful, ${failed} failed`,
      successful,
      failed,
      results,
    };
  }

  async rollbackDevice(deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);

    // The most recent firmware that ran successfully and is not the current one.
    const previous = await this.prisma.firmwareHistory.findFirst({
      where: {
        deviceId: device.id,
        status: 'SUCCESS',
        ...(device.currentFirmwareId
          ? { firmwareId: { not: device.currentFirmwareId } }
          : {}),
      },
      include: { firmware: true },
      orderBy: [{ completedAt: 'desc' }, { appliedAt: 'desc' }],
    });
    if (!previous) {
      throw new NotFoundException('No previous firmware found for this device');
    }

    const deployment = await this.deployToDevice(deviceId, previous.firmwareId);
    return {
      ...deployment,
      message: `Rollback of ${deviceId} to ${previous.firmware.name} ${previous.firmware.version} initiated`,
    };
  }

  // --------------------------------------------------------------- queries

  async getDeployment(deploymentId: string) {
    const deployment = await this.prisma.firmwareHistory.findUnique({
      where: { id: deploymentId },
      include: { firmware: true, device: true },
    });
    if (!deployment) {
      throw new NotFoundException(`Deployment ${deploymentId} not found`);
    }
    return { status: 'success', deployment: this.present(deployment) };
  }

  async getDeploymentHistory() {
    const deployments = await this.prisma.firmwareHistory.findMany({
      include: { firmware: true, device: true },
      orderBy: { appliedAt: 'desc' },
    });
    return {
      status: 'success',
      deployments: deployments.map((d) => this.present(d)),
    };
  }

  async getPendingDeployments() {
    const pending = await this.prisma.firmwareHistory.findMany({
      where: { status: { in: ACTIVE } },
      include: { firmware: true, device: true },
      orderBy: { appliedAt: 'desc' },
    });
    return {
      status: 'success',
      pending: pending.map((p) => ({
        id: p.id,
        deviceId: p.device.deviceId,
        firmware: firmwareSummary(p.firmware),
        status: p.status,
        appliedAt: p.appliedAt,
      })),
    };
  }

  async getDeviceHistory(deviceId: string) {
    const history = await this.prisma.firmwareHistory.findMany({
      where: { device: { deviceId } },
      include: { firmware: true },
      orderBy: { appliedAt: 'desc' },
    });
    return {
      deviceId,
      history: await Promise.all(
        history.map(async (h) => ({
          id: h.id,
          firmware: {
            ...firmwareSummary(h.firmware),
            s3Url: await this.firmwareService.signedUrl(h.firmware),
          },
          appliedAt: h.appliedAt,
          status: h.status,
          completedAt: h.completedAt,
          errorMessage: h.errorMessage,
        })),
      ),
    };
  }

  // ------------------------------------------------------------ MQTT events

  /** The device reports the result of an OTA attempt. */
  @OnEvent(DEVICE_EVENTS.ACK)
  async onAck({ deviceId, payload }: DeviceEvent<DeviceAckMessage>) {
    const reportedId =
      typeof payload.deployment_id === 'string' &&
      UUID_PATTERN.test(payload.deployment_id)
        ? payload.deployment_id
        : undefined;

    // Protocol 2 devices echo the deployment ID. Older ones do not, so their
    // ack is attributed to the device's single active deployment.
    const deployment = await this.prisma.firmwareHistory.findFirst({
      where: reportedId
        ? { id: reportedId, device: { deviceId } }
        : { device: { deviceId }, status: { in: ACTIVE } },
      orderBy: { appliedAt: 'desc' },
    });
    if (!deployment) {
      this.logger.warn(`Ack from ${deviceId} matches no deployment; ignoring`);
      return;
    }

    if (payload.success === true) {
      // An ack that names its deployment is trusted even after a timeout.
      const from: DeploymentStatus[] = reportedId
        ? [...ACTIVE, 'TIMEOUT']
        : ACTIVE;
      if (await this.finish(deployment.id, 'SUCCESS', from)) {
        this.logger.log(`Deployment ${deployment.id} succeeded on ${deviceId}`);
      }
    } else {
      const reason =
        typeof payload.message === 'string' && payload.message
          ? payload.message.slice(0, 500)
          : 'Unknown error';
      if (await this.finish(deployment.id, 'FAILED', ACTIVE, reason)) {
        this.logger.error(
          `Deployment ${deployment.id} failed on ${deviceId}: ${reason}`,
        );
      }
    }
  }

  /**
   * The device (re)connected. For protocol 2 devices, which report the
   * firmware they run, this settles whatever was left open: a lost ack, an
   * update interrupted by a reboot, or an offer sent while it was offline.
   */
  @OnEvent(DEVICE_EVENTS.REQUEST)
  async onRequest({ deviceId, payload }: DeviceEvent<DeviceRequestMessage>) {
    if (typeof payload.protocol !== 'number' || payload.protocol < 2) return;

    const active = await this.prisma.firmwareHistory.findFirst({
      where: { device: { deviceId }, status: { in: ACTIVE } },
      include: { firmware: true, device: true },
      orderBy: { appliedAt: 'desc' },
    });
    if (!active) return;

    if (payload.firmware_id === active.firmwareId) {
      if (await this.finish(active.id, 'SUCCESS', ACTIVE)) {
        this.logger.log(
          `Deployment ${active.id} confirmed: ${deviceId} is running the new firmware`,
        );
      }
      return;
    }

    if (active.status === 'IN_PROGRESS') {
      await this.finish(
        active.id,
        'FAILED',
        ['IN_PROGRESS'],
        'Device restarted without applying the update',
      );
      this.logger.error(
        `Deployment ${active.id} was interrupted on ${deviceId}`,
      );
      return;
    }

    try {
      await this.sendOffer(active.device, active.firmware, active.id);
      this.logger.log(`Re-sent deployment ${active.id} to ${deviceId}`);
    } catch (error) {
      this.logger.warn(
        `Could not re-send deployment ${active.id}: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent(DEVICE_EVENTS.STATUS)
  async onStatus({ deviceId, payload }: DeviceEvent<DeviceStatusMessage>) {
    if (toConnectionStatus(payload.status) !== 'updating') return;

    await this.prisma.firmwareHistory.updateMany({
      where: { device: { deviceId }, status: 'PENDING' },
      data: { status: 'IN_PROGRESS' },
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async timeOutStaleDeployments() {
    const { count } = await this.prisma.firmwareHistory.updateMany({
      where: {
        status: { in: ACTIVE },
        appliedAt: { lt: new Date(Date.now() - this.timeoutMs) },
      },
      data: {
        status: 'TIMEOUT',
        completedAt: new Date(),
        errorMessage: 'Deployment timed out - no response from device',
      },
    });
    if (count > 0) this.logger.warn(`Timed out ${count} deployment(s)`);
  }

  // --------------------------------------------------------------- helpers

  private async sendOffer(
    device: Device & { currentFirmware?: Firmware | null },
    firmware: Firmware,
    deploymentId: string,
  ) {
    const current =
      device.currentFirmware ??
      (device.currentFirmwareId
        ? await this.prisma.firmware.findUnique({
            where: { id: device.currentFirmwareId },
          })
        : null);

    await this.mqtt.publishFirmwareOffer({
      device_id: device.deviceId,
      deployment_id: deploymentId,
      firmware_id: firmware.id,
      firmware_name: firmware.name,
      firmware_version: firmware.version,
      firmware_url: await this.firmwareService.signedUrl(firmware),
      md5: firmware.md5,
      size: firmware.size,
      current_firmware: current?.version ?? 'unknown',
      timestamp: Date.now(),
    });
  }

  /**
   * Moves a deployment to a final state, but only from one of the `from`
   * states, which makes duplicate acks and racing handlers harmless.
   * Returns whether this call performed the transition.
   */
  private async finish(
    deploymentId: string,
    status: 'SUCCESS' | 'FAILED',
    from: DeploymentStatus[],
    errorMessage?: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.firmwareHistory.updateMany({
        where: { id: deploymentId, status: { in: from } },
        data: {
          status,
          completedAt: new Date(),
          errorMessage: errorMessage ?? null,
        },
      });
      if (count === 0) return false;

      if (status === 'SUCCESS') {
        const deployment = await tx.firmwareHistory.findUniqueOrThrow({
          where: { id: deploymentId },
        });
        await tx.device.update({
          where: { id: deployment.deviceId },
          data: { currentFirmwareId: deployment.firmwareId },
        });
      }
      return true;
    });
  }

  private present(deployment: DeploymentWithRelations) {
    return {
      id: deployment.id,
      deviceId: deployment.device.deviceId,
      firmware: firmwareSummary(deployment.firmware),
      status: deployment.status,
      appliedAt: deployment.appliedAt,
      completedAt: deployment.completedAt,
      errorMessage: deployment.errorMessage,
    };
  }

  private describeError(error: unknown) {
    if (error instanceof HttpException) {
      return { statusCode: error.getStatus(), message: error.message };
    }
    this.logger.error('Unexpected deployment error', error);
    return { statusCode: 500, message: 'Internal server error' };
  }
}
