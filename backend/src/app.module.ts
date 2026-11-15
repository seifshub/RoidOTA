import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { memoryStorage } from 'multer';
import { join } from 'path';
import { AppController } from './app.controller';
import { ApiKeyGuard } from './common/api-key.guard';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { DeploymentModule } from './deployment/deployment.module';
import { DeviceModule } from './device/device.module';
import { FirmwareController } from './firmware/firmware.controller';
import { FirmwareModule } from './firmware/firmware.module';
import { MqttModule } from './mqtt/mqtt.module';
import { PrismaModule } from './prisma/prisma.module';
import { S3Module } from './s3/s3.module';

// An optional web dashboard build can be dropped into backend/public.
const publicDir = join(__dirname, '..', 'public');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    ...(existsSync(join(publicDir, 'index.html'))
      ? [
          ServeStaticModule.forRoot({
            rootPath: publicDir,
            exclude: ['/firmware/{*path}', '/health', '/api/{*path}'],
          }),
        ]
      : []),
    // Firmware is kept in memory just long enough to hash it and push it to S3.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: config.getOrThrow<number>('firmware.maxSizeBytes'),
          files: 1,
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    S3Module,
    MqttModule,
    DeviceModule,
    FirmwareModule,
    DeploymentModule,
  ],
  controllers: [AppController, FirmwareController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
