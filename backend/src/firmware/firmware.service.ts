import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MqttService } from '../mqtt/mqtt.service';
import { CompilationService } from '../compilation/compilation.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { UploadFirmwareDto } from './dtos/upload-firmware.dto';
import { CompileFirmwareDto } from './dtos/compile-firmware.dto';


@Injectable()
export class FirmwareService {

    private readonly logger = new Logger(FirmwareService.name);

    constructor(
    private readonly mqttService: MqttService,
    private readonly compilationService: CompilationService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  async getManifest(): Promise<Record<string, string>> {
    return this.storageService.loadManifest();
  }
  async updateManifest(manifest: Record<string, string>): Promise<{ status: string; message: string }> {
    try {
      await this.storageService.saveManifest(manifest);
      return { status: 'success', message: 'Manifest updated successfully' };
    } catch (error) {
      this.logger.error('Failed to update manifest', error);
      throw new HttpException('Failed to update manifest', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

   async processUserCode(file: Express.Multer.File, uploadDto: UploadFirmwareDto) {
    try {
      this.logger.log(`Processing user code for devices: ${uploadDto.targetDevices.join(', ')}`);

      const userCode = file.buffer.toString('utf-8');
      
      const compilationResults: {
        success: boolean;
        deviceId: string;
        firmwareName: string;
        binaryPath: string;
        size: number;
      }[] = [];

      for (const deviceId of uploadDto.targetDevices) {
        const result = await this.compilationService.compileForDevice({
          deviceId,
          userCode,
          firmwareName: uploadDto.firmwareName || `firmware_${deviceId}_${Date.now()}`,
          deviceConfig: uploadDto.deviceConfigs?.[deviceId] || {},
        });

        compilationResults.push(result);

        // Update manifest
        const manifest = await this.getManifest();
        manifest[deviceId] = result.firmwareName;
        await this.updateManifest(manifest);
      }

      // Optionally auto-deploy if specified
      if (uploadDto.autoDeploy) {
        await this.batchDeploy(uploadDto.targetDevices, compilationResults[0].firmwareName);
      }

      return {
        status: 'success',
        message: 'Firmware compiled successfully',
        results: compilationResults,
      };
    } catch (error) {
      this.logger.error('Failed to process user code', error);
      throw new HttpException('Compilation failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async compileFirmware(compileDto: CompileFirmwareDto) {
    return this.compilationService.compileForDevice(compileDto);
  }

  async deployToDevice(deviceId: string, firmwareName: string) {
    try {
      const firmwareUrl = `${this.configService.get('app.baseUrl')}/firmware/${firmwareName}`;
      await this.mqttService.publishFirmwareResponse(deviceId, firmwareUrl);
      
      this.logger.log(`Deployed firmware ${firmwareName} to device ${deviceId}`);
      
      return {
        status: 'success',
        message: `Firmware deployed to ${deviceId}`,
        deviceId,
        firmwareName,
      };
    } catch (error) {
      this.logger.error(`Failed to deploy to device ${deviceId}`, error);
      throw new HttpException('Deployment failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async batchDeploy(deviceIds: string[], firmwareName: string) {
    const results = await Promise.allSettled(
      deviceIds.map(deviceId => this.deployToDevice(deviceId, firmwareName))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return {
      status: 'completed',
      message: `Deployment completed: ${successful} successful, ${failed} failed`,
      successful,
      failed,
      results,
    };
  }

  async getDeviceStatuses() {
    return this.mqttService.getDeviceStatuses();
  }

  async getDeviceStatus(deviceId: string) {
    return this.mqttService.getDeviceStatus(deviceId);
  }

  async sendDeviceCommand(deviceId: string, command: string, params?: Record<string, any>) {
    try {
      await this.mqttService.sendCommand(deviceId, command, params);
      
      this.logger.log(`Sent command '${command}' to device ${deviceId}`);
      
      return {
        status: 'success',
        message: `Command sent to ${deviceId}`,
        deviceId,
        command,
      };
    } catch (error) {
      this.logger.error(`Failed to send command to device ${deviceId}`, error);
      throw new HttpException('Command failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async restartDevice(deviceId: string) {
    return this.sendDeviceCommand(deviceId, 'restart');
  }

  async requestDeviceHeartbeat(deviceId: string) {
    return this.sendDeviceCommand(deviceId, 'heartbeat');
  }
}
