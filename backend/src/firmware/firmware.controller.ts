import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    UploadedFile,
    UseInterceptors,
    Param,
    HttpStatus,
    HttpException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { FirmwareService } from './firmware.service';
import { UploadFirmwareDto } from './dtos';

@ApiTags('firmware')
@Controller('firmware')
export class FirmwareController {
    constructor(private readonly firmwareService: FirmwareService) { }

    @Get()
    @ApiOperation({ summary: 'List all firmware' })
    async listFirmware() {
        return this.firmwareService.listFirmware();
    }

    @Delete(':firmwareId')
    @ApiOperation({ summary: 'Delete firmware' })
    async deleteFirmware(@Param('firmwareId') firmwareId: string) {
        return this.firmwareService.deleteFirmware(firmwareId);
    }

    @Post('upload/deploy/bin')
    @ApiOperation({ summary: 'Upload and deploy precompiled binary firmware' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('userCode'))
    async uploadAndDeployBin(
        @UploadedFile() file: Express.Multer.File,
        @Body() uploadDto: UploadFirmwareDto,
    ){
        if(!file){ 
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }
        return this.firmwareService.uploadAndDeployBin(file,uploadDto)
    }

    @Post('upload/bin')
    @ApiOperation({ summary: 'Upload precompiled binary firmware' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('userCode'))
    async uploadBin(
        @UploadedFile() file: Express.Multer.File,
        @Body('firmwareName') firmwareName: string,
        @Body('version') version?: string,
    ) {
        if (!file) {
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }
        return this.firmwareService.uploadBin(file, firmwareName, version);
    }

    @Post('deploy/batch')
    @ApiOperation({ summary: 'Deploy firmware to multiple devices' })
    async batchDeploy(@Body() deployData: { devices: string[]; firmwareId: string }) {
        try {
            if (!deployData.firmwareId) {
                throw new HttpException('Firmware ID is required', HttpStatus.BAD_REQUEST);
            }
            if (!deployData.devices || deployData.devices.length === 0) {
                throw new HttpException('At least one device is required', HttpStatus.BAD_REQUEST);
            }
            
            console.log('Batch deploy request:', deployData);
            const result = await this.firmwareService.batchDeploy(deployData.devices, deployData.firmwareId);
            console.log('Batch deploy result:', result);
            return result;
        } catch (error) {
            console.error('Batch deploy error:', error);
            throw error;
        }
    }

    @Post('deploy/:deviceId')
    @ApiOperation({ summary: 'Deploy firmware to specific device' })
    async deployToDevice(
        @Param('deviceId') deviceId: string,
        @Body('firmwareId') firmwareId: string,
    ) {
        if (!firmwareId) {
            throw new HttpException('Firmware ID  is required', HttpStatus.BAD_REQUEST);
        }
        return this.firmwareService.deployToDevice(deviceId, firmwareId);
    }

    @Get('devices')
    @ApiOperation({ summary: 'Get all devices' })
    async getDevices() {
        return this.firmwareService.getDevices();
    }

    @Delete('device/:deviceId')
    @ApiOperation({ summary: 'Delete a device' })
    async deleteDevice(@Param('deviceId') deviceId: string) {
        return this.firmwareService.deleteDevice(deviceId);
    }

    @Get('device/:deviceId/current-firmware')
    @ApiOperation({ summary: 'Get current firmware of a specific device' })
    async getDeviceCurrentFirmware(@Param('deviceId') deviceId: string) {
        return this.firmwareService.getDeviceCurrentFirmware(deviceId);
    }

    @Get('device/statuses')
    @ApiOperation({ summary: 'Get statuses of all devices' })
    async getDeviceStatuses() {
        return this.firmwareService.getDeviceStatuses();
    }

    @Get('devices')
    @ApiOperation({ summary: 'Get all devices from database' })
    async getAllDevices() {
        return this.firmwareService.getAllDevices();
    }

    @Get('device/:deviceId/status')
    @ApiOperation({ summary: 'Get status of a specific device' })
    async getDeviceStatus(@Param('deviceId') deviceId: string) {
        return this.firmwareService.getDeviceStatus(deviceId);
    }

    @Get('device/:deviceId/history')
    @ApiOperation({ summary: 'Get firmware history for a specific device' })
    async getDeviceFirmwareHistory(@Param('deviceId') deviceId: string) {
        return this.firmwareService.getDeviceFirmwareHistory(deviceId);
    }

    @Get('deployments/history')
    @ApiOperation({ summary: 'Get all deployment history' })
    async getDeploymentHistory() {
        return this.firmwareService.getDeploymentHistory();
    }

    @Get('deployments/pending')
    @ApiOperation({ summary: 'Get pending deployments' })
    async getPendingDeployments() {
        return this.firmwareService.getPendingDeployments();
    }

    @Post('device/:deviceId/rollback')
    @ApiOperation({ summary: 'Rollback device to previous firmware' })
    async rollbackDevice(@Param('deviceId') deviceId: string) {
        return this.firmwareService.rollbackDevice(deviceId);
    }

    @Post('device/:deviceId/command')
    @ApiOperation({ summary: 'Send command to device' })
    async sendDeviceCommand(
        @Param('deviceId') deviceId: string,
        @Body('command') command: string,
        @Body('params') params?: Record<string, any>,
    ) {
        if (!command) {
            throw new HttpException('Command is required', HttpStatus.BAD_REQUEST);
        }
        return this.firmwareService.sendDeviceCommand(deviceId, command, params);
    }

    @Post('device/:deviceId/restart')
    @ApiOperation({ summary: 'Restart a specific device' })
    async restartDevice(@Param('deviceId') deviceId: string) {
        return this.firmwareService.restartDevice(deviceId);
    }

    @Post('device/:deviceId/heartbeat')
    @ApiOperation({ summary: 'Request heartbeat from a specific device' })
    async requestDeviceHeartbeat(@Param('deviceId') deviceId: string) {
        return this.firmwareService.requestDeviceHeartbeat(deviceId);
    }

    @Get('test')
    @ApiOperation({ summary: 'Test endpoint for firmware service' })
    async testEndpoint() {
        return { message: 'Firmware service is running' };
    }
}