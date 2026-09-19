import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, Prisma, NotificationStatus } from '@org/database';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { KafkaService } from '@org/kafka';
import { NotificationRequestedEvent } from '@org/contracts';
import { randomUUID } from 'node:crypto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  async create(
    dto: CreateNotificationDto,
  ): Promise<{ id: string; status: NotificationStatus }> {
    const notification = await this.prisma.notification.create({
      data: {
        tenantId: 'demo-tenant',
        channel: dto.channel,
        recipient: dto.recipient,
        payload: dto.payload as Prisma.InputJsonValue,
      },
    });

    const event: NotificationRequestedEvent = {
      eventId: randomUUID(),
      notificationId: notification.id,
      tenantId: notification.tenantId,
      channel: notification.channel,
      recipient: notification.recipient,
      payload: notification.payload as Record<string, unknown>,
      createdAt: notification.createdAt.toISOString(),
    };
    try {
      await this.kafka.publish('notification.requested', event);
    } catch (error) {
      this.logger.error(
        `Failed to publish notification.requested for notification ${notification.id}; it remains PENDING for retry`,
        error instanceof Error ? error.stack : error,
      );
    }

    return {
      id: notification.id,
      status: notification.status,
    };
  }
}
