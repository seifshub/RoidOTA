import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { FirmwareService } from './firmware.service';

@Module({
  imports: [S3Module],
  providers: [FirmwareService],
  exports: [FirmwareService],
})
export class FirmwareModule {}
