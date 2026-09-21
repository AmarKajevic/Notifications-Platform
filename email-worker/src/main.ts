import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { createKafkaConsumerOptions } from '@org/kafka';

import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    createKafkaConsumerOptions({
      clientId: 'email-worker',
      groupId: 'email-worker-group',
    }),
  );

  await app.listen();
}

bootstrap();
