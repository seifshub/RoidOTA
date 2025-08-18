import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { ConfigModule } from '@nestjs/config';
import { DeviceModule } from '../device/device.module';
import { StorageModule } from '../storage/storage.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports :[ConfigModule, DeviceModule, StorageModule, S3Module],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}