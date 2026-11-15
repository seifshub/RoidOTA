import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Device IDs end up inside MQTT topics (roidota/cmd/<id>), so they must not
 * contain topic separators or wildcards ("/", "+", "#").
 */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const isValidDeviceId = (value: unknown): value is string =>
  typeof value === 'string' && DEVICE_ID_PATTERN.test(value);

@Injectable()
export class DeviceIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidDeviceId(value)) {
      throw new BadRequestException(
        'Invalid device ID: use 1-64 letters, digits, "_", "-" or "."',
      );
    }
    return value;
  }
}
