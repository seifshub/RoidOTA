import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MqttService } from '../mqtt/mqtt.service';
import { StorageService } from '../storage/storage.service';
import { S3Service } from '../s3/s3.service';
import { UploadFirmwareDto } from './dtos/upload-firmware.dto';


@Injectable()
export class FirmwareService {

  private readonly logger = new Logger(FirmwareService.name);

  constructor(
    private readonly mqttService: MqttService,
    private readonly storageService: StorageService,
    private readonly s3Service: S3Service,
  ) { }

  async deployToDevice(deviceId: string, firmwareId: string) {
    try {
      console.log(`Attempting to deploy firmware ${firmwareId} to device ${deviceId}`);
      const firmware = await this.storageService.getFirmwareById(firmwareId);

      if (!firmware) {
        console.error(`Firmware not found: ${firmwareId}`);
        throw new Error(`Firmware with ID ${firmwareId} not found`);
      }

      // Record the deployment as PENDING first
      const deployment = await this.storageService.recordFirmwareDeployment(deviceId, firmwareId, 'PENDING');
      console.log(`Recorded deployment with ID: ${deployment.id}`);

      // Send firmware URL to device via MQTT
      await this.mqttService.publishFirmwareResponse(deviceId, firmware.s3Key);
      console.log(`Sent firmware URL to device ${deviceId} via MQTT`);

      this.logger.log(`Initiated firmware deployment ${firmware.name} v${firmware.version} to device ${deviceId}`);

      return {
        status: 'pending',
        message: `Firmware deployment initiated for ${deviceId}`,
        deviceId,
        deploymentId: deployment.id,
        firmware: {
          id: firmware.id,
          name: firmware.name,
          version: firmware.version,
        },
      };
    } catch (error) {
      console.error(`Failed to deploy to device ${deviceId}:`, error);
      this.logger.error(`Failed to deploy to device ${deviceId}`, error);
      throw new HttpException(`Deployment failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async batchDeploy(deviceIds: string[], firmwareId: string) {
    try {
      console.log(`Starting batch deployment of firmware ${firmwareId} to devices:`, deviceIds);
      
      const results = await Promise.allSettled(
        deviceIds.map(deviceId => this.deployToDevice(deviceId, firmwareId))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Failed to deploy to ${deviceIds[index]}:`, result.reason);
        }
      });

      console.log(`Batch deployment completed: ${successful} successful, ${failed} failed`);

      return {
        status: 'completed',
        message: `Deployment completed: ${successful} successful, ${failed} failed`,
        successful,
        failed,
        results,
      };
    } catch (error) {
      console.error('Batch deploy error:', error);
      throw error;
    }
  }

  async getDeviceStatuses() {
    const mqttStatuses = this.mqttService.getDeviceStatuses();

    const enhancedStatuses = await Promise.all(mqttStatuses.map(async (status) => {
      const currentFirmware = await this.storageService.getCurrentFirmwareForDevice(status.deviceId);

      return {
        ...status,
        currentFirmware: currentFirmware ? {
          id: currentFirmware.id,
          name: currentFirmware.name,
          version: currentFirmware.version,
        } : null,
      };
    }));

    return enhancedStatuses;
  }

  async getDevices() {
    try {
      const devices = await this.storageService.getAllDevices();
      return {
        status: 'success',
        devices: devices.map(device => ({
          id: device.id,
          deviceId: device.deviceId,
          ip: device.ip,
          currentFirmware: device.currentFirmware ? {
            id: device.currentFirmware.id,
            name: device.currentFirmware.name,
            version: device.currentFirmware.version,
          } : null,
          createdAt: device.createdAt,
          updatedAt: device.updatedAt,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get devices', error);
      throw new HttpException('Failed to get devices', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteDevice(deviceId: string) {
    try {
      await this.storageService.deleteDevice(deviceId);
      return {
        status: 'success',
        message: `Device ${deviceId} deleted successfully`,
      };
    } catch (error) {
      this.logger.error(`Failed to delete device ${deviceId}`, error);
      throw new HttpException('Failed to delete device', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeviceCurrentFirmware(deviceId: string) {
    try {
      const device = await this.storageService.getDevice(deviceId);
      if (!device) {
        throw new HttpException('Device not found', HttpStatus.NOT_FOUND);
      }

      let currentFirmware: any = null;
      if (device.currentFirmwareId) {
        currentFirmware = await this.storageService.getFirmwareById(device.currentFirmwareId);
      }

      return {
        status: 'success',
        deviceId: device.deviceId,
        currentFirmware: currentFirmware ? {
          name: currentFirmware.name,
          version: currentFirmware.version,
          uploadedAt: currentFirmware.uploadedAt,
        } : null,
      };
    } catch (error) {
      this.logger.error(`Failed to get current firmware for device ${deviceId}`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get device firmware', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeviceStatus(deviceId: string) {
    const mqttStatus = this.mqttService.getDeviceStatus(deviceId);

    if (!mqttStatus) {
      return null;
    }

    const currentFirmware = await this.storageService.getCurrentFirmwareForDevice(deviceId);

    return {
      ...mqttStatus,
      currentFirmware: currentFirmware ? {
        id: currentFirmware.id,
        name: currentFirmware.name,
        version: currentFirmware.version,
      } : null,
    };
  }

  async getAllDevices() {
    const devices = await this.storageService.getAllDevices();
    return {
      status: 'success',
      devices: devices.map(device => ({
        id: device.id,
        deviceId: device.deviceId,
        ip: device.ip,
        currentFirmware: device.currentFirmware ? {
          id: device.currentFirmware.id,
          name: device.currentFirmware.name,
          version: device.currentFirmware.version,
        } : null,
        createdAt: device.createdAt,
        updatedAt: device.lastSeen,
      })),
    };
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

  async uploadBin(file: Express.Multer.File, firmwareName: string, version?: string) {
    try {
      const firmwareVersion = version || `v${Date.now()}`;

      const { s3Key, signedUrl, firmware } = await this.storageService.saveFirmware(
        firmwareName,
        firmwareVersion,
        file.buffer
      );

      return {
        status: 'success',
        message: `Firmware ${firmwareName} v${firmwareVersion} uploaded successfully`,
        firmware: {
          id: firmware.id,
          name: firmware.name,
          version: firmware.version,
          s3Url: signedUrl, 
          uploadedAt: firmware.uploadedAt,
        },
      };
    } catch (error) {
      this.logger.error('Failed to save uploaded .bin', error);
      throw new HttpException('Failed to upload binary', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async uploadAndDeployBin(file: Express.Multer.File, uploadDto: UploadFirmwareDto) {
    const firmwareName = uploadDto.firmwareName || `firmware_${Date.now()}`;
    const firmwareVersion = uploadDto.version || `v${Date.now()}`;

    try {
      const { s3Key, signedUrl, firmware } = await this.storageService.saveFirmware(
        firmwareName,
        firmwareVersion,
        file.buffer
      );

      if (uploadDto.targetDevices?.length) {
        for (const deviceId of uploadDto.targetDevices) {
          await this.storageService.createOrUpdateDevice(deviceId);
        }
      }

      // Auto-deploy if requested
      if (uploadDto.autoDeploy && uploadDto.targetDevices?.length) {
        await this.batchDeploy(uploadDto.targetDevices, firmware.id);
      }

      return {
        status: 'success',
        message: `Firmware ${firmwareName} v${firmwareVersion} uploaded and ${uploadDto.autoDeploy ? 'deployed' : 'ready for deployment'}`,
        firmware: {
          id: firmware.id,
          name: firmware.name,
          version: firmware.version,
          s3Url: signedUrl, 
          uploadedAt: firmware.uploadedAt,
        },
      };
    } catch (error) {
      this.logger.error('Failed to save uploaded .bin', error);
      throw new HttpException('Failed to upload binary', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeviceFirmwareHistory(deviceId: string) {
    const history = await this.storageService.getDeviceFirmwareHistory(deviceId);
    return {
      deviceId,
      history: await Promise.all(history.map(async h => ({
        id: h.id,
        firmware: {
          id: h.firmware.id,
          name: h.firmware.name,
          version: h.firmware.version,
          s3Url: await this.s3Service.getSignedDownloadUrl(h.firmware.s3Key, 3600),
        },
        appliedAt: h.appliedAt,
        status: h.status,
        completedAt: h.completedAt,
        errorMessage: h.errorMessage,
      }))),
    };
  }

  async getDeploymentHistory() {
    const deployments = await this.storageService.getDeploymentHistory();
    return {
      status: 'success',
      deployments: deployments.map(d => ({
        id: d.id,
        deviceId: d.device.deviceId,
        firmware: {
          id: d.firmware.id,
          name: d.firmware.name,
          version: d.firmware.version,
        },
        status: d.status,
        appliedAt: d.appliedAt,
        completedAt: d.completedAt,
        errorMessage: d.errorMessage,
      })),
    };
  }

  async getPendingDeployments() {
    const pending = await this.storageService.getPendingDeployments();
    return {
      status: 'success',
      pending: pending.map(p => ({
        id: p.id,
        deviceId: p.device.deviceId,
        firmware: {
          id: p.firmware.id,
          name: p.firmware.name,
          version: p.firmware.version,
        },
        appliedAt: p.appliedAt,
      })),
    };
  }


  async rollbackDevice(deviceId: string) {
    try {
      const previousFirmware = await this.storageService.getPreviousFirmwareForDevice(deviceId);

      if (!previousFirmware) {
        throw new HttpException('No previous firmware found for this device', HttpStatus.NOT_FOUND);
      }

      // Deploy the previous firmware
      await this.deployToDevice(deviceId, previousFirmware.id);

      return {
        status: 'success',
        message: `Device ${deviceId} rolled back to firmware ${previousFirmware.name} v${previousFirmware.version}`,
        deviceId,
        firmware: {
          id: previousFirmware.id,
          name: previousFirmware.name,
          version: previousFirmware.version,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to rollback device ${deviceId}`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Rollback failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async listFirmware() {
    const firmwareList = await this.storageService.listFirmware();
    return {
      status: 'success',
      firmware: await Promise.all(firmwareList.map(async f => ({
        id: f.id,
        name: f.name,
        version: f.version,
        s3Url: await this.s3Service.getSignedDownloadUrl(f.s3Key, 3600),
        uploadedAt: f.uploadedAt,
      }))),
    };
  }

  async deleteFirmware(firmwareId: string) {
    try {
      await this.storageService.deleteFirmware(firmwareId);
      return {
        status: 'success',
        message: `Firmware deleted successfully`,
      };
    } catch (error) {
      this.logger.error(`Failed to delete firmware ${firmwareId}`, error);
      throw new HttpException('Failed to delete firmware', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
