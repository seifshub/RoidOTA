import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}


  async saveBuildLog(buildId: string, log: string): Promise<void> {
    const logsDir = path.join(
      this.configService.get<string>('storage.firmwareDir')!,
      'build-logs'
    );
    await fs.mkdir(logsDir, { recursive: true });

    const logPath = path.join(logsDir, `${buildId}.log`);
    await fs.writeFile(logPath, log);
  }

  async getBuildLog(buildId: string): Promise<string> {
    const logPath = path.join(
      this.configService.get<string>('storage.firmwareDir')!,
      'build-logs',
      `${buildId}.log`
    );
    return fs.readFile(logPath, 'utf-8');
  }

  async saveFirmware(firmwareName: string, version: string, buffer: Buffer): Promise<{ s3Url: string; firmware: any }> {
    try {
      // Generate S3 key
      const s3Key = this.s3Service.generateFirmwareKey(firmwareName, version);
      
      // Upload to S3
      const s3Url = await this.s3Service.uploadFirmware(s3Key, buffer);
      
      const firmware = await this.prisma.firmware.create({
        data: {
          name: firmwareName,
          version,
          s3Url,
        },
      });

      this.logger.log(`Successfully saved firmware ${firmwareName} v${version}`);
      return { s3Url, firmware };
    } catch (error) {
      this.logger.error(`Failed to save firmware ${firmwareName}`, error);
      throw error;
    }
  }

  async deleteFirmware(firmwareId: string): Promise<void> {
    try {
      const firmware = await this.prisma.firmware.findUnique({
        where: { id: firmwareId },
      });

      if (!firmware) {
        throw new Error('Firmware not found');
      }

      // Extract S3 key from URL
      const s3Key = firmware.s3Url.split('/').slice(-1)[0];
      
      // Delete from S3
      await this.s3Service.deleteFirmware(s3Key);
      
      // Delete from database
      await this.prisma.firmware.delete({
        where: { id: firmwareId },
      });

      this.logger.log(`Successfully deleted firmware ${firmware.name}`);
    } catch (error) {
      this.logger.error(`Failed to delete firmware`, error);
      throw error;
    }
  }

  async listFirmware(): Promise<any[]> {
    return this.prisma.firmware.findMany({
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getFirmwareByName(name: string): Promise<any | null> {
    return this.prisma.firmware.findFirst({
      where: { name },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getFirmwareById(id: string): Promise<any | null> {
    return this.prisma.firmware.findUnique({
      where: { id },
    });
  }

  async createOrUpdateDevice(deviceId: string, ip?: string): Promise<any> {
    return this.prisma.device.upsert({
      where: { deviceId },
      update: {
        ip,
        lastSeen: new Date(),
      },
      create: {
        deviceId,
        ip,
        lastSeen: new Date(),
      },
    });
  }

  async getDevice(deviceId: string): Promise<any | null> {
    return this.prisma.device.findUnique({
      where: { deviceId },
    });
  }

  async getAllDevices(): Promise<any[]> {
    return this.prisma.device.findMany({
      include: { currentFirmware: true },
      orderBy: { lastSeen: 'desc' },
    });
  }

  async deleteDevice(deviceId: string): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    await this.prisma.device.delete({
      where: { deviceId },
    });
    this.logger.log(`Deleted device ${deviceId}`);
  }

  async recordFirmwareDeployment(deviceId: string, firmwareId: string, status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' = 'PENDING'): Promise<any> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    return this.prisma.firmwareHistory.create({
      data: {
        deviceId: device.id,
        firmwareId,
        status: status as any,
      },
    });
  }

  async updateDeploymentStatus(
    deviceId: string, 
    status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'TIMEOUT', 
    errorMessage?: string
  ): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    const pendingDeployment = await this.prisma.firmwareHistory.findFirst({
      where: {
        deviceId: device.id,
        status: 'PENDING' as any,
      },
      orderBy: { appliedAt: 'desc' },
    });

    if (!pendingDeployment) {
      throw new Error(`No pending deployment found for device ${deviceId}`);
    }

    const updatedDeployment = await this.prisma.firmwareHistory.update({
      where: { id: pendingDeployment.id },
      data: {
        status: status as any,
        completedAt: new Date(),
        errorMessage,
      } as any,
    });

    if (status === 'SUCCESS') {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { currentFirmwareId: updatedDeployment.firmwareId },
      });
      
      this.logger.log(`Updated device ${deviceId} current firmware to ${updatedDeployment.firmwareId}`);
    }
  }

  async timeoutPendingDeployments(cutoffDate: Date): Promise<void> {
    await this.prisma.firmwareHistory.updateMany({
      where: {
        status: 'PENDING' as any,
        appliedAt: { lt: cutoffDate },
      },
      data: {
        status: 'TIMEOUT' as any,
        completedAt: new Date(),
        errorMessage: 'Deployment timed out - no response from device',
      } as any,
    });

    this.logger.log(`Timed out pending deployments older than ${cutoffDate}`);
  }

  async getDeviceFirmwareHistory(deviceId: string): Promise<any[]> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      return [];
    }

    return this.prisma.firmwareHistory.findMany({
      where: { deviceId: device.id },
      include: { firmware: true },
      orderBy: { appliedAt: 'desc' },
    });
  }

  async getDeploymentHistory(): Promise<any[]> {
    return this.prisma.firmwareHistory.findMany({
      include: { 
        firmware: true,
        device: true,
      },
      orderBy: { appliedAt: 'desc' },
    });
  }

  async getPendingDeployments(): Promise<any[]> {
    return this.prisma.firmwareHistory.findMany({
      where: { status: 'PENDING' as any },
      include: { 
        firmware: true,
        device: true,
      },
      orderBy: { appliedAt: 'desc' },
    });
  }

  async getCurrentFirmwareForDevice(deviceId: string): Promise<any | null> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { currentFirmware: true },
    });

    if (!device) {
      return null;
    }

    return device.currentFirmware || null;
  }

  async getPreviousFirmwareForDevice(deviceId: string): Promise<any | null> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      return null;
    }

    const histories = await this.prisma.firmwareHistory.findMany({
      where: { 
        deviceId: device.id,
        status: 'SUCCESS' as any,
      },
      include: { firmware: true },
      orderBy: { appliedAt: 'desc' },
      take: 2,
    });

    return histories.length > 1 ? histories[1].firmware : null;
  }
}