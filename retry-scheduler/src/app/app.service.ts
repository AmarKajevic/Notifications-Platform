import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '@org/database';

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/2 * * * * *')
  async processRetries(): Promise<void> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        status: 'RETRYING',
        nextRetryAt: {
          lte: new Date(),
        },
      },
      take: 50,
    });

    for (const notification of notifications) {
      await this.scheduleRetry(notification.id);
    }
  }

  private async scheduleRetry(notificationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.notification.updateMany({
        where: {
          id: notificationId,
          status: 'RETRYING',
          nextRetryAt: {
            lte: new Date(),
          },
        },
        data: {
          status: 'PENDING',
          nextRetryAt: null,
        },
      });

      if (updated.count !== 1) {
        return;
      }

      const notification = await tx.notification.findUniqueOrThrow({
        where: {
          id: notificationId,
        },
      });

      await tx.outboxEvent.create({
        data: {
          topic: 'notification.requested',
          payload: {
            eventId: crypto.randomUUID(),
            notificationId: notification.id,
            tenantId: notification.tenantId,
            channel: notification.channel,
            recipient: notification.recipient,
            payload: notification.payload,
            createdAt: new Date().toISOString(),
          },
        },
      });
    });

    this.logger.log(`Retry scheduled for notification ${notificationId}`);
  }
}
