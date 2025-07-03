import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {}

  async loadManifest(): Promise<Record<string, string>> {
    try {
      const manifestPath = this.configService.get('storage.manifestPath');
      const data = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn('Could not load manifest, returning empty object');
      return {};
    }
  }

  async saveManifest(manifest: Record<string, string>): Promise<void> {
    const manifestPath = this.configService.get('storage.manifestPath');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  async saveFirmware(firmwareName: string, sourcePath: string): Promise<string> {
    const firmwareDir = this.configService.get('storage.firmwareDir');
    await fs.mkdir(firmwareDir, { recursive: true });

    const finalPath = path.join(firmwareDir, `${firmwareName}.bin`);
    await fs.copyFile(sourcePath, finalPath);

    return finalPath;
  }

  async deleteFirmware(firmwareName: string): Promise<void> {
    const firmwareDir = this.configService.get('storage.firmwareDir');
    const firmwarePath = path.join(firmwareDir, `${firmwareName}.bin`);
    await fs.unlink(firmwarePath);
  }

  async listFirmware(): Promise<string[]> {
    const firmwareDir = this.configService.get('storage.firmwareDir');
    try {
      const files = await fs.readdir(firmwareDir);
      return files.filter(f => f.endsWith('.bin')).map(f => f.replace('.bin', ''));
    } catch (error) {
      return [];
    }
  }

  async loadDevices(): Promise<Record<string, any>> {
    try {
      const devicesPath = path.join(
        this.configService.get<string>('storage.firmwareDir')!,
        'devices.json'
      );
      const data = await fs.readFile(devicesPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn('Could not load devices, returning empty object');
      return {};
    }
  }

  async saveDevices(devices: Record<string, any>): Promise<void> {
    const devicesPath = path.join(
      this.configService.get<string>('storage.firmwareDir')!,
      'devices.json'
    );
    await fs.mkdir(path.dirname(devicesPath), { recursive: true });
    await fs.writeFile(devicesPath, JSON.stringify(devices, null, 2));
  }

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

}