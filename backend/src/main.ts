import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // unknown fields are dropped rather than rejected
      transform: true,
    }),
  );

  const origins = config.getOrThrow<string>('corsOrigins');
  app.enableCors({
    origin: origins === '*' ? true : origins.split(',').map((o) => o.trim()),
  });

  // Close the HTTP server, MQTT client and database pool on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  if (config.get<boolean>('swaggerEnabled')) {
    const swagger = new DocumentBuilder()
      .setTitle('RoidOTA API')
      .setDescription('Over-the-Air firmware update management system')
      .setVersion(config.getOrThrow<string>('app.version'))
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
      .build();
    SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, swagger));
  }

  if (!config.get<string>('apiKey')) {
    logger.warn('API_KEY is not set: the API accepts unauthenticated requests');
  }

  const port = config.getOrThrow<number>('port');
  await app.listen(port);
  logger.log(`RoidOTA backend listening on port ${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start RoidOTA backend', error);
  process.exit(1);
});
