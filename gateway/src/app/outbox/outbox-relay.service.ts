import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService, Prisma } from '@org/database';
import { KafkaService } from '@org/kafka';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 10;

interface ClaimedOutboxEvent {
  id: string;
  topic: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

// Relays rows from the outbox table (written in the same DB transaction as
// the domain write, see NotificationsService) onto Kafka. Polling + claiming
// via `FOR UPDATE SKIP LOCKED` means multiple gateway replicas can run this
// concurrently without double-publishing the same event.
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const claimed = await this.claimBatch();
      for (const event of claimed) {
        await this.publishClaimedEvent(event);
      }
    } catch (error) {
      this.logger.error(
        'Outbox relay poll failed',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.polling = false;
    }
  }

  private claimBatch(): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$queryRaw<ClaimedOutboxEvent[]>`
      UPDATE "OutboxEvent"
      SET status = 'PUBLISHING'
      WHERE id IN (
        SELECT id FROM "OutboxEvent"
        WHERE status = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, topic, payload, attempts;
    `;
  }

  private async publishClaimedEvent(event: ClaimedOutboxEvent): Promise<void> {
    try {
      await this.kafka.publish(event.topic, event.payload);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    } catch (error) {
      const attempts = event.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      this.logger.error(
        `Failed to publish outbox event ${event.id} to "${event.topic}" (attempt ${attempts}/${MAX_ATTEMPTS})`,
        error instanceof Error ? error.stack : error,
      );
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
