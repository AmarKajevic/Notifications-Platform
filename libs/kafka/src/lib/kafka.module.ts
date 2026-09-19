import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KafkaService } from './kafka.service.js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.KAFKA,

          options: {
            client: {
              clientId: 'notification-gateway',
              brokers: configService
                .getOrThrow<string>('KAFKA_BROKERS')
                .split(','),
            },

            producerOnlyMode: true,
          },
        }),
      },
    ]),
  ],

  providers: [KafkaService],
  exports: [KafkaService],
})
export class KafkaModule {}