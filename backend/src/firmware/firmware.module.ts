import { Module } from '@nestjs/common';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { CompilationModule } from '../compilation/compilation.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [MqttModule, CompilationModule, StorageModule],
  controllers: [FirmwareController],
  providers: [FirmwareService],
  exports: [FirmwareService],
})
export class FirmwareModule {}