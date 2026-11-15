import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { FirmwareModule } from '../firmware/firmware.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { DeploymentService } from './deployment.service';

@Module({
  imports: [MqttModule, DeviceModule, FirmwareModule],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
