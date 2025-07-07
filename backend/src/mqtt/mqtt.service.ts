import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { 
  DeviceStatus, 
  DeviceRequest, 
  MQTT_TOPICS, 
} from './types';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;
  private deviceStatuses: Map<string, DeviceStatus> = new Map();

  constructor(private readonly configService: ConfigService) {}

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
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.end();
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

  async publishFirmwareResponse(deviceId: string, firmwareUrl: string): Promise<void> {
    const topic = `${MQTT_TOPICS.RESPONSE }${deviceId}`;
    const message = JSON.stringify({
      firmware_url: firmwareUrl,
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

  getDeviceStatuses(): DeviceStatus[] {
    return Array.from(this.deviceStatuses.values());
  }

  getDeviceStatus(deviceId: string): DeviceStatus | undefined {
    return this.deviceStatuses.get(deviceId);
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
      
      // Update device status
      const existingStatus = this.deviceStatuses.get(request.device_id) || {} as DeviceStatus;
      this.deviceStatuses.set(request.device_id, {
        ...existingStatus,
        deviceId: request.device_id,
        ip: request.ip,
        lastSeen: new Date(),
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
      
      this.deviceStatuses.set(deviceId, {
        deviceId,
        ip: status.ip,
        rssi: status.rssi,
        uptime: status.uptime,
        freeHeap: status.free_heap,
        lastSeen: new Date(),
      });

      this.logger.debug(`Status update from ${deviceId}: RSSI=${status.rssi}, Uptime=${status.uptime}ms`);
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
}