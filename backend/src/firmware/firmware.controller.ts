import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DeviceIdPipe } from '../common/device-id';
import { DeploymentService } from '../deployment/deployment.service';
import { DeviceService } from '../device/device.service';
import { MqttService } from '../mqtt/mqtt.service';
import {
  BatchDeployDto,
  DeployDto,
  DeviceCommandDto,
  UploadBinDto,
  UploadFirmwareDto,
} from './dto';
import { FirmwareService } from './firmware.service';

const UPLOAD_FIELD = 'userCode';

const uploadSchema = (extra: Record<string, object> = {}) => ({
  schema: {
    type: 'object',
    required: [UPLOAD_FIELD],
    properties: {
      [UPLOAD_FIELD]: { type: 'string', format: 'binary' },
      firmwareName: { type: 'string' },
      version: { type: 'string' },
      ...extra,
    },
  },
});

@ApiTags('firmware')
@ApiSecurity('api-key')
@Controller('firmware')
export class FirmwareController {
  constructor(
    private readonly firmwareService: FirmwareService,
    private readonly deploymentService: DeploymentService,
    private readonly deviceService: DeviceService,
    private readonly mqttService: MqttService,
  ) {}

  // -------------------------------------------------------------- firmware

  @Get()
  @ApiOperation({ summary: 'List all firmware' })
  listFirmware() {
    return this.firmwareService.list();
  }

  @Delete(':firmwareId')
  @ApiOperation({ summary: 'Delete firmware that is not in use' })
  deleteFirmware(@Param('firmwareId', ParseUUIDPipe) firmwareId: string) {
    return this.firmwareService.delete(firmwareId);
  }

  @Post('upload/bin')
  @ApiOperation({ summary: 'Upload precompiled binary firmware' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(uploadSchema())
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  async uploadBin(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadBinDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const firmware = await this.firmwareService.upload(
      file,
      dto.firmwareName,
      dto.version,
    );
    return {
      status: 'success',
      message: `Firmware ${firmware.name} ${firmware.version} uploaded successfully`,
      firmware: await this.firmwareService.present(firmware),
    };
  }

  @Post('upload/deploy/bin')
  @ApiOperation({ summary: 'Upload binary firmware and optionally deploy it' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(
    uploadSchema({
      targetDevices: { type: 'array', items: { type: 'string' } },
      autoDeploy: { type: 'boolean' },
    }),
  )
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  async uploadAndDeployBin(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadFirmwareDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const targets = dto.targetDevices ?? [];
    if (dto.autoDeploy && targets.length === 0) {
      throw new BadRequestException(
        'autoDeploy requires at least one target device',
      );
    }

    const firmware = await this.firmwareService.upload(
      file,
      dto.firmwareName,
      dto.version,
    );
    // Targets may be devices that have not connected yet; register them so the
    // firmware reaches them as soon as they do.
    await Promise.all(targets.map((id) => this.deviceService.register(id)));

    const deployment = dto.autoDeploy
      ? await this.deploymentService.batchDeploy(targets, firmware.id)
      : null;

    return {
      status: 'success',
      message: deployment
        ? `Firmware ${firmware.name} ${firmware.version} uploaded; ${deployment.message.toLowerCase()}`
        : `Firmware ${firmware.name} ${firmware.version} uploaded and ready for deployment`,
      firmware: await this.firmwareService.present(firmware),
      deployment,
    };
  }

  // ------------------------------------------------------------ deployments

  @Post('deploy/batch')
  @ApiOperation({ summary: 'Deploy firmware to multiple devices' })
  batchDeploy(@Body() dto: BatchDeployDto) {
    return this.deploymentService.batchDeploy(dto.devices, dto.firmwareId);
  }

  @Post('deploy/:deviceId')
  @ApiOperation({ summary: 'Deploy firmware to a specific device' })
  deployToDevice(
    @Param('deviceId', DeviceIdPipe) deviceId: string,
    @Body() dto: DeployDto,
  ) {
    return this.deploymentService.deployToDevice(deviceId, dto.firmwareId);
  }

  @Get('deployments/history')
  @ApiOperation({ summary: 'Get all deployment history' })
  getDeploymentHistory() {
    return this.deploymentService.getDeploymentHistory();
  }

  @Get('deployments/pending')
  @ApiOperation({ summary: 'Get deployments that are still in flight' })
  getPendingDeployments() {
    return this.deploymentService.getPendingDeployments();
  }

  @Get('deployments/:deploymentId')
  @ApiOperation({ summary: 'Get a single deployment' })
  getDeployment(@Param('deploymentId', ParseUUIDPipe) deploymentId: string) {
    return this.deploymentService.getDeployment(deploymentId);
  }

  // ---------------------------------------------------------------- devices

  @Get('devices')
  @ApiOperation({ summary: 'Get all registered devices' })
  getDevices() {
    return this.deviceService.listDevices();
  }

  @Get('device/statuses')
  @ApiOperation({ summary: 'Get live statuses of all devices' })
  getDeviceStatuses() {
    return this.deviceService.getStatuses();
  }

  @Delete('device/:deviceId')
  @ApiOperation({ summary: 'Delete a device and its history' })
  deleteDevice(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.deviceService.deleteDevice(deviceId);
  }

  @Get('device/:deviceId/current-firmware')
  @ApiOperation({ summary: 'Get current firmware of a specific device' })
  getDeviceCurrentFirmware(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.deviceService.getCurrentFirmware(deviceId);
  }

  @Get('device/:deviceId/status')
  @ApiOperation({ summary: 'Get live status of a specific device' })
  getDeviceStatus(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.deviceService.getStatus(deviceId);
  }

  @Get('device/:deviceId/history')
  @ApiOperation({ summary: 'Get firmware history for a specific device' })
  getDeviceFirmwareHistory(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.deploymentService.getDeviceHistory(deviceId);
  }

  @Post('device/:deviceId/rollback')
  @ApiOperation({ summary: 'Roll a device back to its previous firmware' })
  rollbackDevice(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.deploymentService.rollbackDevice(deviceId);
  }

  @Post('device/:deviceId/command')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a command to a device' })
  sendDeviceCommand(
    @Param('deviceId', DeviceIdPipe) deviceId: string,
    @Body() dto: DeviceCommandDto,
  ) {
    return this.sendCommand(deviceId, dto.command, dto.params);
  }

  @Post('device/:deviceId/restart')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restart a specific device' })
  restartDevice(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.sendCommand(deviceId, 'restart');
  }

  @Post('device/:deviceId/heartbeat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a heartbeat from a specific device' })
  requestDeviceHeartbeat(@Param('deviceId', DeviceIdPipe) deviceId: string) {
    return this.sendCommand(deviceId, 'heartbeat');
  }

  @Get('test')
  @ApiOperation({ summary: 'Test endpoint for the firmware service' })
  testEndpoint() {
    return { message: 'Firmware service is running' };
  }

  private async sendCommand(
    deviceId: string,
    command: string,
    params?: Record<string, unknown>,
  ) {
    await this.mqttService.sendCommand(deviceId, command, params);
    return {
      status: 'success',
      message: `Command sent to ${deviceId}`,
      deviceId,
      command,
    };
  }
}
