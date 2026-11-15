import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { DEVICE_ID_PATTERN } from '../../common/device-id';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const COMMAND_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const NAME_MESSAGE =
  'firmwareName must be 1-64 letters, digits, spaces, ".", "_" or "-"';
const VERSION_MESSAGE =
  'version must be 1-32 letters, digits, ".", "_", "+" or "-"';
const DEVICE_MESSAGE =
  'each device ID must be 1-64 letters, digits, "_", "-" or "."';

/**
 * Multipart forms send everything as text, so device lists arrive either as
 * a JSON array string, a comma separated string, or repeated fields.
 */
const toStringArray = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (text === '') return [];
  if (text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return value;
    }
  }
  return text.split(',').map((item) => item.trim());
};

const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class UploadBinDto {
  @ApiPropertyOptional({ description: 'Firmware name' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  firmwareName?: string;

  @ApiPropertyOptional({ description: 'Firmware version' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(VERSION_PATTERN, { message: VERSION_MESSAGE })
  version?: string;
}

export class UploadFirmwareDto extends UploadBinDto {
  @ApiPropertyOptional({ description: 'Target device IDs', type: [String] })
  @Transform(toStringArray)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Matches(DEVICE_ID_PATTERN, { each: true, message: DEVICE_MESSAGE })
  targetDevices?: string[];

  @ApiPropertyOptional({
    description: 'Deploy to the target devices right away',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  autoDeploy?: boolean;
}

export class DeployDto {
  @ApiProperty({ description: 'ID of the firmware to deploy' })
  @IsUUID()
  firmwareId: string;
}

export class BatchDeployDto extends DeployDto {
  @ApiProperty({ description: 'Target device IDs', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @Matches(DEVICE_ID_PATTERN, { each: true, message: DEVICE_MESSAGE })
  devices: string[];
}

export class DeviceCommandDto {
  @ApiProperty({ description: 'Command name', example: 'restart' })
  @IsString()
  @Matches(COMMAND_PATTERN, {
    message: 'command must be 1-32 lower-case letters, digits, "_" or "-"',
  })
  command: string;

  @ApiPropertyOptional({ description: 'Command parameters' })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
