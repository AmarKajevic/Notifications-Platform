import { Injectable } from '@nestjs/common';

// Set from main.ts once the Kafka consumer has joined its group, so readiness
// reflects "can actually receive events", not just "process is up".
@Injectable()
export class HealthState {
  private consumerReady = false;

  markConsumerReady(): void {
    this.consumerReady = true;
  }

  get isConsumerReady(): boolean {
    return this.consumerReady;
  }
}
