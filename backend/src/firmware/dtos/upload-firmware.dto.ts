import { IsArray, IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadFirmwareDto {
  @ApiProperty({ description: 'Target device IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  targetDevices: string[];

  @ApiProperty({ description: 'Firmware name', required: false })
  @IsOptional()
  @IsString()
  firmwareName?: string;

  @ApiProperty({ description: 'Auto-deploy after compilation', required: false })
  @IsOptional()
  @IsBoolean()
  autoDeploy?: boolean;

  @ApiProperty({ description: 'Device-specific configurations', required: false })
  @IsOptional()
  @IsObject()
  deviceConfigs?: Record<string, any>;
}