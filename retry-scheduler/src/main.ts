import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module';

async function bootstrap() {
  // No HTTP or Kafka surface here — this process only exists to run the
  // @Cron job in RetryService, so createApplicationContext boots the DI
  // container (and lifecycle hooks) without opening a port that would
  // otherwise collide with the gateway's own HTTP server on 3000.
  await NestFactory.createApplicationContext(AppModule);
  Logger.log('Retry scheduler started');
}

bootstrap();
