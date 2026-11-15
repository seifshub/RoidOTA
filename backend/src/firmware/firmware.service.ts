import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Firmware } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';

/** First byte of every ESP8266/ESP32 application image. */
const ESP_IMAGE_MAGIC = 0xe9;

const slug = (value: string) =>
  value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'firmware';

export interface UploadedBinary {
  buffer: Buffer;
  originalname?: string;
}

@Injectable()
export class FirmwareService {
  private readonly logger = new Logger(FirmwareService.name);
  private readonly settings: AppConfig['firmware'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    config: ConfigService,
  ) {
    this.settings = config.getOrThrow<AppConfig['firmware']>('firmware');
  }

  async upload(file: UploadedBinary, name?: string, version?: string) {
    const firmwareName = name?.trim() || `firmware_${Date.now()}`;
    const firmwareVersion = version?.trim() || `v${Date.now()}`;
    const buffer = file?.buffer;

    if (!buffer?.length) {
      throw new BadRequestException('Uploaded firmware file is empty');
    }
    if (this.settings.validateImage && buffer[0] !== ESP_IMAGE_MAGIC) {
      throw new BadRequestException(
        'File is not an ESP firmware image (it must start with byte 0xE9)',
      );
    }

    const duplicate = await this.prisma.firmware.findFirst({
      where: { name: firmwareName, version: firmwareVersion },
    });
    if (duplicate) {
      throw new ConflictException(
        `Firmware ${firmwareName} ${firmwareVersion} already exists`,
      );
    }

    const s3Key = `firmware/${slug(firmwareName)}/${slug(firmwareVersion)}-${randomUUID()}.bin`;
    await this.s3.upload(s3Key, buffer);

    let firmware: Firmware;
    try {
      firmware = await this.prisma.firmware.create({
        data: {
          name: firmwareName,
          version: firmwareVersion,
          s3Key,
          size: buffer.length,
          md5: createHash('md5').update(buffer).digest('hex'),
          sha256: createHash('sha256').update(buffer).digest('hex'),
        },
      });
    } catch (error) {
      // Do not leave an orphaned object behind when the row cannot be written.
      await this.s3
        .delete(s3Key)
        .catch(() => this.logger.warn(`Could not clean up orphan ${s3Key}`));
      throw error;
    }

    this.logger.log(`Stored firmware ${firmware.name} ${firmware.version}`);
    return firmware;
  }

  async list() {
    const firmware = await this.prisma.firmware.findMany({
      orderBy: { uploadedAt: 'desc' },
    });
    return {
      status: 'success',
      firmware: await Promise.all(firmware.map((f) => this.present(f))),
    };
  }

  async getOrThrow(firmwareId: string): Promise<Firmware> {
    const firmware = await this.prisma.firmware.findUnique({
      where: { id: firmwareId },
    });
    if (!firmware) {
      throw new NotFoundException(`Firmware ${firmwareId} not found`);
    }
    return firmware;
  }

  async delete(firmwareId: string) {
    const firmware = await this.getOrThrow(firmwareId);

    const [runningOn, activeDeployments] = await Promise.all([
      this.prisma.device.count({ where: { currentFirmwareId: firmwareId } }),
      this.prisma.firmwareHistory.count({
        where: { firmwareId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      }),
    ]);
    if (runningOn > 0) {
      throw new ConflictException(
        `Firmware is currently running on ${runningOn} device(s)`,
      );
    }
    if (activeDeployments > 0) {
      throw new ConflictException(
        `Firmware has ${activeDeployments} deployment(s) in progress`,
      );
    }

    // Database first: if this fails nothing is lost. The opposite order would
    // leave a firmware row pointing at a deleted object.
    await this.prisma.$transaction([
      this.prisma.firmwareHistory.deleteMany({ where: { firmwareId } }),
      this.prisma.firmware.delete({ where: { id: firmwareId } }),
    ]);
    await this.s3
      .delete(firmware.s3Key)
      .catch((error: Error) =>
        this.logger.warn(
          `Firmware row deleted but object ${firmware.s3Key} remains: ${error.message}`,
        ),
      );

    this.logger.log(`Deleted firmware ${firmware.name} ${firmware.version}`);
    return { status: 'success', message: 'Firmware deleted successfully' };
  }

  signedUrl(firmware: Pick<Firmware, 's3Key'>): Promise<string> {
    return this.s3.getSignedDownloadUrl(
      firmware.s3Key,
      this.settings.downloadUrlTtlSeconds,
    );
  }

  /** API representation of a firmware, including a temporary download URL. */
  async present(firmware: Firmware) {
    return {
      id: firmware.id,
      name: firmware.name,
      version: firmware.version,
      size: firmware.size,
      md5: firmware.md5,
      sha256: firmware.sha256,
      s3Url: await this.signedUrl(firmware),
      uploadedAt: firmware.uploadedAt,
    };
  }
}
