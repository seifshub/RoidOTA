import { Module } from '@nestjs/common';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { StorageModule } from '../storage/storage.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [MqttModule, StorageModule, S3Module],
  controllers: [FirmwareController],
  providers: [FirmwareService],
  exports: [FirmwareService],
})
export class FirmwareModule {}