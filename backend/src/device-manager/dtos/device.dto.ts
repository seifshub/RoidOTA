import { IsString, IsOptional, IsObject, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDeviceDto {
  @ApiProperty({ description: 'Device ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Device name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Device type', required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: 'IP Address', required: false })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiProperty({ description: 'MAC Address', required: false })
  @IsOptional()
  @IsString()
  macAddress?: string;

  @ApiProperty({ description: 'Device configuration', required: false })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class UpdateDeviceDto {
  @ApiProperty({ description: 'Device name', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Device type', required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: 'Device status', required: false })
  @IsOptional()
  @IsEnum(['online', 'offline', 'updating'])
  status?: 'online' | 'offline' | 'updating';

  @ApiProperty({ description: 'Firmware version', required: false })
  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @ApiProperty({ description: 'IP Address', required: false })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiProperty({ description: 'MAC Address', required: false })
  @IsOptional()
  @IsString()
  macAddress?: string;

  @ApiProperty({ description: 'Device configuration', required: false })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}