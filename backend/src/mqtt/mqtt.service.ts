import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import {
  DeviceStatus,
  DeviceRequest,
  MQTT_TOPICS,
} from './types';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;
  private deviceStatuses: Map<string, DeviceStatus> = new Map();
  private firmwareManifest: Record<string, string> = {};

  constructor(private readonly configService: ConfigService) { }

  async onModuleInit() {
    const brokerUrl = `mqtt://${this.configService.get('mqtt.broker')}:${this.configService.get('mqtt.port')}`;

    this.client = mqtt.connect(brokerUrl, {
      username: this.configService.get('mqtt.username'),
      password: this.configService.get('mqtt.password'),
    });

    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker at ${brokerUrl}`);

      // Subscribe to all relevant topics
      this.client.subscribe(MQTT_TOPICS.REQUEST);
      this.client.subscribe(`${MQTT_TOPICS.STATUS}+`);
      this.client.subscribe(`${MQTT_TOPICS.LOGS}+`);
      this.client.subscribe(`${MQTT_TOPICS.ACK}+`);
    });

    this.client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload.toString());
    });

    this.client.on('error', (error) => {
      this.logger.error('MQTT connection error', error);
    });

    // Load firmware manifest on startup
    await this.loadFirmwareManifest();
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.end();
    }
  }

  private async loadFirmwareManifest(): Promise<void> {
    try {
      const manifestPath = this.configService.get('storage.manifestPath');
      const fs = await import('fs/promises');
      const data = await fs.readFile(manifestPath, 'utf-8');
      this.firmwareManifest = JSON.parse(data);
      this.logger.log('Firmware manifest loaded successfully');
    } catch (error) {
      this.logger.warn('Could not load firmware manifest, using empty manifest');
      this.firmwareManifest = {};
    }
  }

  async updateFirmwareManifest(manifest: Record<string, string>): Promise<void> {
    this.firmwareManifest = { ...manifest };
    this.logger.log('Firmware manifest updated');
  }

  private getFirmwareName(deviceId: string): string {
    const firmwareName = this.firmwareManifest[deviceId];

    return firmwareName ? firmwareName : 'unknown';
  }

  async publish(topic: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, { qos: 1 }, (error) => {
        if (error) {
          this.logger.error(`Failed to publish to ${topic}`, error);
          reject(error);
        } else {
          this.logger.log(`Published to ${topic}: ${message}`);
          resolve();
        }
      });
    });
  }

  async publishFirmwareResponse(deviceId: string, firmwareUrl: string): Promise<void> {
    const topic = `${MQTT_TOPICS.RESPONSE}${deviceId}`;
    const firmwareName = this.getFirmwareName(deviceId);

    const message = JSON.stringify({
      firmware_url: firmwareUrl,
      current_firmware: firmwareName,
      timestamp: Date.now(),
      device_id: deviceId
    });

    await this.publish(topic, message);
  }

  async sendCommand(deviceId: string, command: string, params?: Record<string, any>): Promise<void> {
    const topic = `${MQTT_TOPICS.CMD}${deviceId}`;
    const message = JSON.stringify({
      command,
      params: params || {},
      timestamp: Date.now()
    });

    await this.publish(topic, message);
  }

  async sendTest(deviceId: string, message: string): Promise<void> {
    const topic = `user/esp/command`;
    await this.publish(topic, message);
  }

  getDeviceStatuses(): DeviceStatus[] {
    return Array.from(this.deviceStatuses.values()).map(status => ({
      ...status,
      firmwareName: this.getFirmwareName(status.deviceId)
    }));
  }

  getDeviceStatus(deviceId: string): DeviceStatus | undefined {
    const status = this.deviceStatuses.get(deviceId);
    if (status) {
      return {
        ...status,
        firmwareName: this.getFirmwareName(status.deviceId)
      };
    }
    return undefined;
  }

  private handleMessage(topic: string, message: string) {
    try {
      if (topic === MQTT_TOPICS.REQUEST) {
        this.handleDeviceRequest(message);
      } else if (topic.startsWith(MQTT_TOPICS.STATUS)) {
        this.handleDeviceStatus(topic, message);
      } else if (topic.startsWith(MQTT_TOPICS.LOGS)) {
        this.handleDeviceLogs(topic, message);
      } else if (topic.startsWith(MQTT_TOPICS.ACK)) {
        this.handleDeviceAck(topic, message);
      }
    } catch (error) {
      this.logger.error(`Error handling message from ${topic}`, error);
    }
  }

  private handleDeviceRequest(message: string) {
    try {
      const request: DeviceRequest = JSON.parse(message);
      this.logger.log(`Device request from ${request.device_id}: ${message}`);

      // Get firmware info for this device
      const firmwareName = this.getFirmwareName(request.device_id);

      // Update device status
      const existingStatus = this.deviceStatuses.get(request.device_id) || {} as DeviceStatus;
      this.deviceStatuses.set(request.device_id, {
        ...existingStatus,
        deviceId: request.device_id,
        ip: request.ip,
        lastSeen: new Date(),
        firmwareName: firmwareName
      });

      // Trigger firmware lookup and response
      // This will be handled by the firmware service
    } catch (error) {
      this.logger.error('Failed to parse device request', error);
    }
  }

  private handleDeviceStatus(topic: string, message: string) {
    try {
      const deviceId = topic.replace(MQTT_TOPICS.STATUS, '');
      const status = JSON.parse(message.trim());

      // Get firmware info for this device
      const firmwareName = this.getFirmwareName(deviceId);

      this.deviceStatuses.set(deviceId, {
        deviceId,
        status: status.status === 'updating' ? 'updating' :
          status.status === 'error' ? 'error' : 'online',
        ip: status.ip,
        rssi: status.rssi,
        uptime: status.uptime,
        freeHeap: status.free_heap,
        lastSeen: new Date(),
        firmwareName: firmwareName,
      });

      this.logger.debug(`Status update from ${deviceId}: RSSI=${status.rssi}, Uptime=${status.uptime}ms, Firmware=${firmwareName}`);
    } catch (error) {
      this.logger.error(`Failed to parse device status from ${topic}`, error);
    }
  }

  private handleDeviceLogs(topic: string, message: string) {
    try {
      const deviceId = topic.replace(MQTT_TOPICS.LOGS, '');
      const logData = JSON.parse(message);

      this.logger.log(`[${deviceId}] ${logData.level}: ${logData.message}`);
    } catch (error) {
      this.logger.error(`Failed to parse device logs from ${topic}`, error);
    }
  }

  private handleDeviceAck(topic: string, message: string) {
    try {
      const deviceId = topic.replace(MQTT_TOPICS.ACK, '');
      const ackData = JSON.parse(message);

      if (ackData.success) {
        this.logger.log(`OTA update successful for device ${deviceId}`);
        // Reload manifest after successful OTA update
        this.loadFirmwareManifest();
      } else {
        this.logger.error(`OTA update failed for device ${deviceId}: ${ackData.message}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse device acknowledgment from ${topic}`, error);
    }
  }

  async subscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  @Cron('*/30 * * * * *')  // 30 seconds
  checkDeviceExpirations() {
    const now = Date.now();
    const offlineThreshold = 60000; // 60 seconds

    for (const [deviceId, status] of this.deviceStatuses.entries()) {
      const lastSeen = new Date(status.lastSeen).getTime();

      if (now - lastSeen > offlineThreshold && status.status !== 'offline') {
        status.status = 'offline';
        this.deviceStatuses.set(deviceId, status);
        // Optionally: Emit event if you want to notify others
        // this.eventEmitter.emit('device.status.changed', status);
      }
    }
  }
}