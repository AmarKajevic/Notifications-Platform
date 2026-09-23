import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module';

async function bootstrap() {
  // This process only exists to run the @Cron job in RetryService. The HTTP
  // listener is just for /health and /ready probes, so it gets its own port
  // (default 3003) rather than colliding with the gateway on 3000.
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.HEALTH_PORT ?? 3003);
  Logger.log('Retry scheduler started');
}

bootstrap();
