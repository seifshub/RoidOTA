import { IsString, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompileFirmwareDto {
  @ApiProperty({ description: 'Device ID' })
  @IsString()
  deviceId: string;

  @ApiProperty({ description: 'User code to compile' })
  @IsString()
  userCode: string;

  @ApiProperty({ description: 'Firmware name' })
  @IsString()
  firmwareName: string;

  @ApiProperty({ description: 'Device configuration', required: false })
  @IsOptional()
  @IsObject()
  deviceConfig?: Record<string, any>;
}