import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/api-key.guard';
import type { AppConfig } from './config/configuration';
import { MqttService } from './mqtt/mqtt.service';
import { PrismaService } from './prisma/prisma.service';
import { S3Service } from './s3/s3.service';

@Controller()
@ApiTags('app')
export class AppController {
  private readonly app: AppConfig['app'];

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly s3: S3Service,
  ) {
    this.app = config.getOrThrow<AppConfig['app']>('app');
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check: 200 when every dependency is up' })
  async getHealth() {
    const [database, storage] = await Promise.all([
      this.prisma.isHealthy(),
      this.s3.isHealthy(),
    ]);
    const checks = {
      database: database ? 'up' : 'down',
      mqtt: this.mqtt.isConnected() ? 'up' : 'down',
      storage: storage ? 'up' : 'down',
    };
    const healthy = Object.values(checks).every((state) => state === 'up');

    const body = {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: `${this.app.name} Backend`,
      version: this.app.version,
      checks,
    };
    if (!healthy) throw new ServiceUnavailableException(body);
    return body;
  }
}
