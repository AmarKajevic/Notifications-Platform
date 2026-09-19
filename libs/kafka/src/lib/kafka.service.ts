import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject('KAFKA_SERVICE')
    private readonly client: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async publish<T>(topic: string, payload: T): Promise<void> {
    await lastValueFrom(
      this.client.emit(topic, payload),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}