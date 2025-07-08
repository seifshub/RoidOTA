import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CompilationUtils } from '../utils/compilation.utils';
import { FileUtils } from '../utils/file.utils';

const execAsync = promisify(exec);

@Injectable()
export class CompilationService {
  private readonly logger = new Logger(CompilationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) { }

  async compileForDevice(params: {
    deviceId: string;
    userCode: string;
    firmwareName: string;
    deviceConfig?: Record<string, any>;
  }) {
    const { deviceId, userCode, firmwareName, deviceConfig } = params;

    // const validation = CompilationUtils.validateArduinoCode(userCode);
    // if (!validation.valid) {
    //   throw new Error(`Invalid user code: ${validation.errors.join(', ')}`);
    // }
    // Create temporary project directory
    const tempBaseDir = this.configService.get('compilation.tempDir', { infer: true });
    const tempDir = path.join(tempBaseDir, `${deviceId}_${Date.now()}`);
    await FileUtils.ensureDirectory(tempDir);
    try {

      const completeFirmware = await this.generateCompleteFirmware(userCode, deviceId, deviceConfig);
      await this.writeFirmwareFiles(tempDir, completeFirmware, deviceId, deviceConfig);

      const binaryPath = await this.compileFirmware(tempDir);
      const finalBinaryPath = await this.storageService.saveFirmware(firmwareName, binaryPath);

      await fs.rm(tempDir, { recursive: true, force: true });

      this.logger.log(`Successfully compiled firmware for device ${deviceId}`);

      return {
        success: true,
        deviceId,
        firmwareName,
        binaryPath: finalBinaryPath,
        size: await FileUtils.getFileSize(finalBinaryPath),
        hash: await FileUtils.calculateFileHash(finalBinaryPath),
      };
    } catch (error) {
      this.logger.error(`Compilation failed for device ${deviceId}`, error);
      throw error;
    }
  }

  private async generateCompleteFirmware(
    userCode: string,
    deviceId: string,
    deviceConfig?: Record<string, any>
  ): Promise<string> {
    const templatePath = path.join(__dirname, '../../templates/base-firmware/main.cpp');
    let template = await fs.readFile(templatePath, 'utf-8');

    // Replace placeholders
    template = template.replace('{{MQTT_SERVER}}', '192.168.1.26');
    template = template.replace('{{USER_SETUP}}', CompilationUtils.extractSetupBody(userCode));
    template = template.replace('{{USER_LOOP}}', CompilationUtils.extractLoopBody(userCode));
    template = template.replace('{{USER_FUNCTIONS}}', CompilationUtils.extractExtraFunctions(userCode));


    return template;
  }

  private async writeFirmwareFiles(
    tempDir: string,
    firmwareCode: string,
    deviceId: string,
    deviceConfig?: Record<string, any>
  ) {
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, 'main.cpp'), firmwareCode);

    const headerSource = path.join(__dirname, '../../templates/base-firmware/roidOTA.h');
    await fs.copyFile(headerSource, path.join(srcDir, 'roidOTA.h'));

    const platformioIni = await this.generatePlatformioConfig(deviceId, deviceConfig);
    await fs.writeFile(path.join(tempDir, 'platformio.ini'), platformioIni);
  }


  private async generatePlatformioConfig(deviceId: string, deviceConfig?: Record<string, any>): Promise<string> {

    const templatePath = path.join(__dirname, `../../templates/base-firmware/platformio.ini`);
    let template = await fs.readFile(templatePath, 'utf-8');

    // Replace placeholders
    template = template.replace('{{DEVICE_ID}}', deviceId);
    template = template.replace('{{HEARTBEAT_INTERVAL}}', (deviceConfig?.heartbeatInterval || 30000).toString());

    // Handle extra build flags
    const extraBuildFlags = deviceConfig?.buildFlags ?
      deviceConfig.buildFlags.map((flag: string) => `    ${flag}`).join('\n') : '';
    template = template.replace('{{EXTRA_BUILD_FLAGS}}', extraBuildFlags);

    // Handle extra configuration
    template = template.replace('{{EXTRA_CONFIG}}', deviceConfig?.extraConfig || '');

    return template;
  }

  private async compileFirmware(projectDir: string): Promise<string> {
    const platformioPath = this.configService.get('compilation.platformioPath');
    const cmd = `${platformioPath} run --project-dir "${projectDir}"`;
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        maxBuffer: 1024 * 1024 * 10,
      });

      this.logger.log('PlatformIO compilation output:\n', stdout);
      if (stderr) this.logger.warn('PlatformIO Warnings:\n' + stderr);

      const binPath = path.join(projectDir, '.pio/build/esp32dev/firmware.bin');

      await fs.access(binPath);
      return binPath;
    } catch (error) {
      this.logger.error('Compilation failed', error);
      throw new Error(`PlatformIO compilation failed: ${error.message}`);
    }
  }
}
