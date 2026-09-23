import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { createKafkaConsumerOptions } from '@org/kafka';
import { AppModule } from './app/webhook.module';
import { HealthState } from './app/health/health.state';

async function bootstrap() {
  // Hybrid app: the Kafka consumer does the real work, and a small HTTP
  // listener exists only so orchestrators can probe /health and /ready.
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>(
    createKafkaConsumerOptions({
      clientId: 'webhook-worker',
      groupId: 'webhook-worker-group',
    }),
  );

  // Listen first so /health answers while the consumer is still connecting
  // (/ready stays 503 until it has joined the group).
  await app.listen(process.env.HEALTH_PORT ?? 3002);
  await app.startAllMicroservices();
  app.get(HealthState).markConsumerReady();
}

bootstrap();
