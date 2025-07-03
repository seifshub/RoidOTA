import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MqttService } from '../mqtt/mqtt.service';
import { StorageService } from '../storage/storage.service';
import { CreateDeviceDto, UpdateDeviceDto } from './dtos/device.dto';

interface Device {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline' | 'updating';
  lastSeen: Date;
  firmwareVersion: string;
  ipAddress?: string;
  macAddress?: string;
  config: Record<string, any>;
  logs: DeviceLog[];
}

interface DeviceLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

@Injectable()
export class DeviceManagerService {
  private readonly logger = new Logger(DeviceManagerService.name);
  private devices: Map<string, Device> = new Map();

  constructor(
    private readonly mqttService: MqttService,
    private readonly storageService: StorageService,
  ) {
    this.loadDevices();
  }

  async getAllDevices(statusFilter?: string): Promise<Device[]> {
    const devices = Array.from(this.devices.values());
    
    if (statusFilter) {
      return devices.filter(device => device.status === statusFilter);
    }
    
    return devices;
  }

  async getDevice(deviceId: string): Promise<Device> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
    return device;
  }

  async createDevice(createDeviceDto: CreateDeviceDto): Promise<Device> {
    const device: Device = {
      id: createDeviceDto.id,
      name: createDeviceDto.name,
      type: createDeviceDto.type || 'ESP32',
      status: 'offline',
      lastSeen: new Date(),
      firmwareVersion: 'unknown',
      config: createDeviceDto.config || {},
      logs: [],
      ...createDeviceDto,
    };

    this.devices.set(device.id, device);
    await this.saveDevices();

    this.logger.log(`Device ${device.id} registered`);
    return device;
  }

  async updateDevice(deviceId: string, updateDeviceDto: UpdateDeviceDto): Promise<Device> {
    const device = await this.getDevice(deviceId);
    
    Object.assign(device, updateDeviceDto);
    await this.saveDevices();

    this.logger.log(`Device ${deviceId} updated`);
    return device;
  }

  async removeDevice(deviceId: string): Promise<void> {
    if (!this.devices.has(deviceId)) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    this.devices.delete(deviceId);
    await this.saveDevices();

    this.logger.log(`Device ${deviceId} removed`);
  }

  async getDeviceStatus(deviceId: string): Promise<{ status: string; lastSeen: Date; uptime?: number }> {
    const device = await this.getDevice(deviceId);
    
    // Update status based on last seen time
    const now = new Date();
    const timeDiff = now.getTime() - device.lastSeen.getTime();
    const isOnline = timeDiff < 60000; // 1 minute threshold

    device.status = isOnline ? 'online' : 'offline';

    return {
      status: device.status,
      lastSeen: device.lastSeen,
      uptime: isOnline ? timeDiff : undefined,
    };
  }

  async pingDevice(deviceId: string): Promise<{ success: boolean; responseTime?: number }> {
    const device = await this.getDevice(deviceId);
    
    try {
      const startTime = Date.now();
      const pingTopic = `roidota/ping/${deviceId}`;
      
      await this.mqttService.publish(pingTopic, JSON.stringify({ 
        timestamp: startTime,
        action: 'ping' 
      }));

      // In a real implementation, you'd wait for a response
      // For now, we'll simulate it
      const responseTime = Date.now() - startTime;

      this.addDeviceLog(deviceId, 'info', `Ping successful: ${responseTime}ms`);

      return { success: true, responseTime };
    } catch (error) {
      this.addDeviceLog(deviceId, 'error', `Ping failed: ${error.message}`);
      return { success: false };
    }
  }

  async getDeviceLogs(deviceId: string): Promise<DeviceLog[]> {
    const device = await this.getDevice(deviceId);
    return device.logs.slice(-100); // Return last 100 logs
  }

  async updateDeviceStatus(deviceId: string, status: Device['status']): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      device.lastSeen = new Date();
      await this.saveDevices();
    }
  }

  async addDeviceLog(deviceId: string, level: DeviceLog['level'], message: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.logs.push({
        timestamp: new Date(),
        level,
        message,
      });

      // Keep only last 1000 logs
      if (device.logs.length > 1000) {
        device.logs = device.logs.slice(-1000);
      }

      await this.saveDevices();
    }
  }

  private async loadDevices(): Promise<void> {
    try {
      const devicesData = await this.storageService.loadDevices();
      
      for (const [id, deviceData] of Object.entries(devicesData)) {
        this.devices.set(id, deviceData as Device);
      }

      this.logger.log(`Loaded ${this.devices.size} devices`);
    } catch (error) {
      this.logger.warn('Could not load devices, starting with empty registry');
    }
  }

  private async saveDevices(): Promise<void> {
    const devicesData = Object.fromEntries(this.devices);
    await this.storageService.saveDevices(devicesData);
  }
}