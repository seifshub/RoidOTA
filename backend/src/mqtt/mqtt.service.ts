import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import {
  DeviceStatus,
  DeviceRequest,
  MQTT_TOPICS,
} from './types';
import { Cron } from '@nestjs/schedule';
import { DeviceService } from 'src/device/device.service';
import { StorageService } from 'src/storage/storage.service';
import { S3Service } from 'src/s3/s3.service';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;
  private deviceStatuses: Map<string, DeviceStatus> = new Map();

  constructor(
    private readonly configService: ConfigService, 
    private readonly deviceService: DeviceService,
    private readonly storageService: StorageService,
    private readonly s3Service: S3Service,
  ) {}

  async onModuleInit() {
    const brokerUrl = `mqtt://${this.configService.get('mqtt.broker')}:${this.configService.get('mqtt.port')}`;

    this.client = mqtt.connect(brokerUrl, {
      username: this.configService.get('mqtt.username'),
      password: this.configService.get('mqtt.password'),
    });

    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker at ${brokerUrl}`);

      // Subscribe to all relevant topics
      this.client.subscribe(MQTT_TOPICS.REQUEST, (err) => {
        if (err) this.logger.error(`Failed to subscribe to ${MQTT_TOPICS.REQUEST}`, err);
        else this.logger.log(`Subscribed to ${MQTT_TOPICS.REQUEST}`);
      });
      
      this.client.subscribe(`${MQTT_TOPICS.STATUS}+`, (err) => {
        if (err) this.logger.error(`Failed to subscribe to ${MQTT_TOPICS.STATUS}+`, err);
        else this.logger.log(`Subscribed to ${MQTT_TOPICS.STATUS}+`);
      });
      
      this.client.subscribe(`${MQTT_TOPICS.LOGS}+`, (err) => {
        if (err) this.logger.error(`Failed to subscribe to ${MQTT_TOPICS.LOGS}+`, err);
        else this.logger.log(`Subscribed to ${MQTT_TOPICS.LOGS}+`);
      });
      
      this.client.subscribe(`${MQTT_TOPICS.ACK}+`, (err) => {
        if (err) this.logger.error(`Failed to subscribe to ${MQTT_TOPICS.ACK}+`, err);
        else this.logger.log(`Subscribed to ${MQTT_TOPICS.ACK}+`);
      });
    });

    this.client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload.toString());
    });

    this.client.on('error', (error) => {
      this.logger.error('MQTT connection error', error);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.end();
    }
  }

  private async getCurrentFirmware(deviceId: string): Promise<string | null> {
    try {
      const device = await this.deviceService.findByDeviceId(deviceId);
      return device?.currentFirmware || null;
    } catch (error) {
      this.logger.error(`Failed to get current firmware for device ${deviceId}`, error);
      return null;
    }
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

  async publishFirmwareResponse(deviceId: string, s3Key: string): Promise<void> {
    const topic = `${MQTT_TOPICS.RESPONSE}${deviceId}`;
    const currentFirmware = await this.getCurrentFirmware(deviceId);

    // Generate signed URL for the S3 key (valid for 1 hour)
    const signedUrl = await this.s3Service.getSignedDownloadUrl(s3Key, 3600);

    const message = JSON.stringify({
      firmware_url: signedUrl,
      current_firmware: currentFirmware || 'unknown',
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
    return Array.from(this.deviceStatuses.values());
  }

  getDeviceStatus(deviceId: string): DeviceStatus | undefined {
    return this.deviceStatuses.get(deviceId);
  }

  private handleMessage(topic: string, message: string) {
    try {
      this.logger.debug(`Received MQTT message on topic: ${topic}, message: ${message}`);
      
      if (topic === MQTT_TOPICS.REQUEST) {
        this.handleDeviceRequest(message);
      } else if (topic.startsWith(MQTT_TOPICS.STATUS)) {
        this.handleDeviceStatus(topic, message);
      } else if (topic.startsWith(MQTT_TOPICS.LOGS)) {
        this.handleDeviceLogs(topic, message);
      } else if (topic.startsWith(MQTT_TOPICS.ACK)) {
        this.logger.debug(`Calling handleDeviceAck for topic: ${topic}`);
        this.handleDeviceAck(topic, message);
      } else {
        this.logger.warn(`Unhandled MQTT topic: ${topic}`);
      }
    } catch (error) {
      this.logger.error(`Error handling message from ${topic}`, error);
    }
  }

  private async handleDeviceRequest(message: string) {
    try {
      const request: DeviceRequest = JSON.parse(message);
      this.logger.log(`Device request from ${request.device_id}: ${message}`);

      await this.deviceService.findOrCreateDevice(request.device_id, request.ip);

      const currentFirmware = await this.getCurrentFirmware(request.device_id);

      const existingStatus = this.deviceStatuses.get(request.device_id) || {} as DeviceStatus;
      this.deviceStatuses.set(request.device_id, {
        ...existingStatus,
        deviceId: request.device_id,
        ip: request.ip,
        lastSeen: new Date(),
      });

    } catch (error) {
      this.logger.error('Failed to handle device request', error);
    }
  }

  private async handleDeviceStatus(topic: string, message: string) {
    try {
      const deviceId = topic.replace(MQTT_TOPICS.STATUS, '');
      const status = JSON.parse(message.trim());

      const currentFirmware = await this.getCurrentFirmware(deviceId);
      const currentTime = new Date();

      this.deviceStatuses.set(deviceId, {
        deviceId,
        status: status.status === 'updating' ? 'updating' :
          status.status === 'error' ? 'error' : 'online',
        ip: status.ip,
        rssi: status.rssi,
        uptime: status.uptime,
        freeHeap: status.free_heap,
        lastSeen: currentTime,
      });

      this.logger.debug(`Status update from ${deviceId} at ${currentTime.toISOString()}: status=${status.status || 'online'}, RSSI=${status.rssi}, Uptime=${status.uptime}ms`);
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

  private async handleDeviceAck(topic: string, message: string) {
    try {
      const deviceId = topic.replace(MQTT_TOPICS.ACK, '');
      const ackData = JSON.parse(message);
      this.logger.log(`success: ${ackData.success}, message: ${ackData.message}, status: ${ackData.status}, timestamp: ${ackData.timestamp}`);
      if (ackData.success) {
        this.logger.log(`OTA update successful for device ${deviceId} (status: ${ackData.status || 'unknown'}, timestamp: ${ackData.timestamp || 'unknown'})`);
        await this.storageService.updateDeploymentStatus(deviceId, 'SUCCESS');
      } else {
        const errorMessage = ackData.message || 'Unknown error';
        this.logger.error(`OTA update failed for device ${deviceId}: ${errorMessage} (status: ${ackData.status || 'unknown'})`);
        await this.storageService.updateDeploymentStatus(deviceId, 'FAILED', errorMessage);
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
  async checkDeviceExpirations() {
    const now = Date.now();
    const offlineThreshold = 60000; // 60 seconds

    for (const [deviceId, status] of this.deviceStatuses.entries()) {
      const lastSeen = new Date(status.lastSeen).getTime();

      if (now - lastSeen > offlineThreshold && status.status !== 'offline') {
        this.logger.log(`Device ${deviceId} marked as offline - last seen ${Math.floor((now - lastSeen) / 1000)}s ago`);
        status.status = 'offline';
        this.deviceStatuses.set(deviceId, status);
      }
    }
  }

  @Cron('*/60 * * * * *') // Every minute
  async checkPendingDeployments() {
    const timeout = 5 * 60 * 1000; // 5 minutes
    const cutoff = new Date(Date.now() - timeout);
    
    await this.storageService.timeoutPendingDeployments(cutoff);
  }
}