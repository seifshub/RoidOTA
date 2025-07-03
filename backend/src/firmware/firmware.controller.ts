import {
  Controller,
  Post,
  Get,
  Put,
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
import { UploadFirmwareDto , CompileFirmwareDto } from './dtos';

@ApiTags('firmware')
@Controller('firmware')
export class FirmwareController {
    constructor(private readonly firmwareService: FirmwareService) {}

    @Get('manifest')
    @ApiOperation({ summary: 'Get firmware manifest' })
    async getManifest() {
        return this.firmwareService.getManifest();
    }

    @Put('manifest')
    @ApiOperation({ summary: 'Update firmware manifest' })
    async updateManifest(@Body() manifest: Record<string, string>) {
        return this.firmwareService.updateManifest(manifest);
    }

    @Post('upload')
    @ApiOperation({ summary: 'Upload user code and compile firmware' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('userCode'))
    async uploadAndCompile(
        @UploadedFile() file: Express.Multer.File,
        @Body() uploadDto: UploadFirmwareDto,
    ) {
        if (!file) {
        throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }

        return this.firmwareService.processUserCode(file, uploadDto);
    }

    @Post('compile')
    @ApiOperation({ summary: 'Compile firmware for specific devices' })
    async compileFirmware(@Body() compileDto: CompileFirmwareDto) {
        return this.firmwareService.compileFirmware(compileDto);
    }

    @Post('deploy/:deviceId')
    @ApiOperation({ summary: 'Deploy firmware to specific device' })
    async deployToDevice(
        @Param('deviceId') deviceId: string,
        @Body('firmwareName') firmwareName: string,
    ) {
        return this.firmwareService.deployToDevice(deviceId, firmwareName);
    }
    
    @Post('deploy/batch')
    @ApiOperation({ summary: 'Deploy firmware to multiple devices' })
    async batchDeploy(@Body() deployData: { devices: string[]; firmwareName: string }) {
        return this.firmwareService.batchDeploy(deployData.devices, deployData.firmwareName);
    }
}
