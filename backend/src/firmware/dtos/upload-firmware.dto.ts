import { IsArray, IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UploadFirmwareDto {
  @ApiProperty({ description: 'Target device IDs', type: [String] })
  @Transform(({ value }) => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @IsArray()
  @IsString({ each: true })
  targetDevices: string[];

  @ApiProperty({ description: 'Firmware name', required: false })
  @IsOptional()
  @IsString()
  firmwareName?: string;

  @ApiProperty({ description: 'Auto-deploy after compilation', required: false })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  autoDeploy?: boolean;

  @ApiProperty({ description: 'Device-specific configurations', required: false })
  @Transform(({ value }) => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @IsOptional()
  @IsObject()
  deviceConfigs?: Record<string, any>;
}