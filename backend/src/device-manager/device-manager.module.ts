import { Module } from '@nestjs/common';
import { DeviceManagerController } from './device-manager.controller';
import { DeviceManagerService } from './device-manager.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [MqttModule, StorageModule],
  controllers: [DeviceManagerController],
  providers: [DeviceManagerService],
  exports: [DeviceManagerService],
})
export class DeviceManagerModule {}