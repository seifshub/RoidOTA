import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { ConfigModule } from '@nestjs/config';
import { DeviceModule } from '../device/device.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports :[ConfigModule, DeviceModule, StorageModule],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}