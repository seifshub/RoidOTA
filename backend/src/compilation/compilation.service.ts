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

    const validation = CompilationUtils.validateArduinoCode(userCode);
    if (!validation.valid) {
      throw new Error(`Invalid user code: ${validation.errors.join(', ')}`);
    }
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
    template = template.replace('{{MQTT_SERVER}}', deviceConfig?.mqttServer || '192.168.1.100');
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
    await fs.writeFile(path.join(tempDir, 'main.cpp'), firmwareCode);

    const headerSource = path.join(__dirname, '../../templates/base-firmware/roidOTA.h');
    await fs.copyFile(headerSource, path.join(tempDir, 'roidOTA.h'));

    const platformioIni = this.generatePlatformioConfig(deviceId, deviceConfig);
    await fs.writeFile(path.join(tempDir, 'platformio.ini'), platformioIni);
  }

  private generatePlatformioConfig(deviceId: string, deviceConfig?: Record<string, any>): string {
    return `
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
upload_port = /dev/cu.usbserial-9
monitor_speed = 115200

; Core libraries for RoidOTA
lib_deps = 
    tzapu/WiFiManager
    knolleary/PubSubClient
    bblanchon/ArduinoJson@^6.21.3
    HTTPClient
    Update

; Build flags
build_flags = 
    -DDEVICE_ID=\\"${deviceId}\\"
    -DCORE_DEBUG_LEVEL=3
    -DCONFIG_ARDUHAL_LOG_COLORS=1
    -DMQTT_MAX_PACKET_SIZE=512
    -DHEARTBEAT_INTERVAL=30000

; Upload settings
upload_speed = 921600
monitor_filters = esp32_exception_decoder
${deviceConfig?.extraConfig || ''}
`.trim();
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
