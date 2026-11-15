import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { FirmwareService } from './firmware.service';

const image = Buffer.from([0xe9, 1, 2, 3]);

describe('FirmwareService', () => {
  let prisma: any;
  let s3: any;
  let service: FirmwareService;

  const build = (validateImage = true) =>
    new FirmwareService(
      prisma as PrismaService,
      s3 as S3Service,
      {
        getOrThrow: () => ({ validateImage, downloadUrlTtlSeconds: 60 }),
      } as unknown as ConfigService,
    );

  beforeEach(() => {
    prisma = {
      firmware: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(({ data }) => Promise.resolve({ id: 'fw-1', ...data })),
        delete: jest.fn(),
      },
      device: { count: jest.fn().mockResolvedValue(0) },
      firmwareHistory: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    s3 = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = build();
  });

  it('stores the binary under a sanitised key with its checksums', async () => {
    const firmware = await service.upload({ buffer: image }, 'My App', '1.0.0');

    expect(firmware.s3Key).toMatch(
      /^firmware\/My-App\/1\.0\.0-[0-9a-f-]{36}\.bin$/,
    );
    expect(s3.upload).toHaveBeenCalledWith(firmware.s3Key, image);
    expect(firmware.size).toBe(4);
    expect(firmware.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(firmware.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a name and version when none are given', async () => {
    const firmware = await service.upload({ buffer: image });
    expect(firmware.name).toMatch(/^firmware_\d+$/);
    expect(firmware.version).toMatch(/^v\d+$/);
  });

  it('rejects empty files and files that are not ESP images', async () => {
    await expect(
      service.upload({ buffer: Buffer.alloc(0) }, 'a', '1'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upload({ buffer: Buffer.from('ELF') }, 'a', '1'),
    ).rejects.toThrow(BadRequestException);
    expect(s3.upload).not.toHaveBeenCalled();
  });

  it('can skip image validation when configured to', async () => {
    service = build(false);
    await expect(
      service.upload({ buffer: Buffer.from('raw') }, 'a', '1'),
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate name and version before uploading', async () => {
    prisma.firmware.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.upload({ buffer: image }, 'a', '1')).rejects.toThrow(
      ConflictException,
    );
    expect(s3.upload).not.toHaveBeenCalled();
  });

  it('removes the uploaded object when the database write fails', async () => {
    prisma.firmware.create.mockRejectedValue(new Error('db down'));
    await expect(service.upload({ buffer: image }, 'a', '1')).rejects.toThrow(
      'db down',
    );
    expect(s3.delete).toHaveBeenCalledWith(s3.upload.mock.calls[0][0]);
  });

  describe('delete', () => {
    beforeEach(() => {
      prisma.firmware.findUnique.mockResolvedValue({
        id: 'fw-1',
        s3Key: 'k',
        name: 'a',
        version: '1',
      });
    });

    it('refuses while the firmware runs on a device, leaving storage untouched', async () => {
      prisma.device.count.mockResolvedValue(2);
      await expect(service.delete('fw-1')).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(s3.delete).not.toHaveBeenCalled();
    });

    it('keeps the object when the database delete fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('fk violation'));
      await expect(service.delete('fw-1')).rejects.toThrow('fk violation');
      expect(s3.delete).not.toHaveBeenCalled();
    });

    it('still succeeds when only the storage cleanup fails', async () => {
      s3.delete.mockRejectedValue(new Error('s3 down'));
      await expect(service.delete('fw-1')).resolves.toMatchObject({
        status: 'success',
      });
    });
  });
});
