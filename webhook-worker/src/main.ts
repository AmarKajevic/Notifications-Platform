import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { createKafkaConsumerOptions } from '@org/kafka';
import { AppModule } from './app/webhook.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    createKafkaConsumerOptions({
      clientId: 'webhook-worker',
      groupId: 'webhook-worker-group',
    }),
  );

  await app.listen();
}

bootstrap();
