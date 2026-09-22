import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app/app.module';

function getKafkaBrokers(): string[] {
  const brokers = process.env.KAFKA_BROKERS;

  if (!brokers) {
    throw new Error('KAFKA_BROKERS is not defined');
  }

  return brokers.split(',');
}

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'email-worker',
          brokers: getKafkaBrokers(),
        },

        consumer: {
          groupId: 'email-worker-group',
        },

        subscribe: {
          fromBeginning: true,
        },
      },
    },
  );

  await app.listen();
}

bootstrap();
