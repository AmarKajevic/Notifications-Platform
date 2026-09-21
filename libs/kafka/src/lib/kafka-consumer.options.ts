import { MicroserviceOptions, Transport } from '@nestjs/microservices';

export interface KafkaConsumerOptions {
  clientId: string;
  groupId: string;
  fromBeginning?: boolean;
}

// Builds the options NestFactory.createMicroservice() needs to bootstrap a
// Kafka consumer. Every worker (email-worker, webhook-worker, ...) shares
// this instead of hand-rolling its own Transport.KAFKA config.
export function createKafkaConsumerOptions({
  clientId,
  groupId,
  fromBeginning = true,
}: KafkaConsumerOptions): MicroserviceOptions {
  const brokers = process.env.KAFKA_BROKERS;

  if (!brokers) {
    throw new Error('KAFKA_BROKERS is not defined');
  }

  return {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId,
        brokers: brokers.split(','),
      },
      consumer: {
        groupId,
      },
      subscribe: {
        fromBeginning,
      },
    },
  };
}
