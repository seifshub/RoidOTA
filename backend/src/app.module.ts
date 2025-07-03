import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FirmwareModule } from './firmware/firmware.module';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MqttModule } from './mqtt/mqtt.module';
import { CompilationModule } from './compilation/compilation.module';
import { StorageModule } from './storage/storage.module';
import { DeviceManagerModule } from './device-manager/device-manager.module';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    MulterModule.register({
      dest: './uploads',
    }),
    FirmwareModule,
    MqttModule,
    CompilationModule,
    StorageModule,
    DeviceManagerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
