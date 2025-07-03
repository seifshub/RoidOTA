import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DeviceManagerService } from './device-manager.service';
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device.dto';

@ApiTags('devices')
@Controller('devices')
export class DeviceManagerController {
  constructor(private readonly deviceManagerService: DeviceManagerService) {}

  @Get()
  @ApiOperation({ summary: 'Get all devices' })
  @ApiQuery({ name: 'status', required: false, enum: ['online', 'offline', 'updating'] })
  async getAllDevices(@Query('status') status?: string) {
    return this.deviceManagerService.getAllDevices(status);
  }

  @Get(':deviceId')
  @ApiOperation({ summary: 'Get device by ID' })
  async getDevice(@Param('deviceId') deviceId: string) {
    return this.deviceManagerService.getDevice(deviceId);
  }

  @Post()
  @ApiOperation({ summary: 'Register new device' })
  async createDevice(@Body() createDeviceDto: CreateDeviceDto) {
    return this.deviceManagerService.createDevice(createDeviceDto);
  }

  @Put(':deviceId')
  @ApiOperation({ summary: 'Update device configuration' })
  async updateDevice(
    @Param('deviceId') deviceId: string,
    @Body() updateDeviceDto: UpdateDeviceDto,
  ) {
    return this.deviceManagerService.updateDevice(deviceId, updateDeviceDto);
  }

  @Delete(':deviceId')
  @ApiOperation({ summary: 'Remove device' })
  async removeDevice(@Param('deviceId') deviceId: string) {
    return this.deviceManagerService.removeDevice(deviceId);
  }

  @Get(':deviceId/status')
  @ApiOperation({ summary: 'Get device status' })
  async getDeviceStatus(@Param('deviceId') deviceId: string) {
    return this.deviceManagerService.getDeviceStatus(deviceId);
  }

  @Post(':deviceId/ping')
  @ApiOperation({ summary: 'Ping device' })
  async pingDevice(@Param('deviceId') deviceId: string) {
    return this.deviceManagerService.pingDevice(deviceId);
  }

  @Get(':deviceId/logs')
  @ApiOperation({ summary: 'Get device logs' })
  async getDeviceLogs(@Param('deviceId') deviceId: string) {
    return this.deviceManagerService.getDeviceLogs(deviceId);
  }
}