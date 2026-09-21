import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { NotificationRequestedEvent } from '@org/contracts';
import { PrismaService } from '@org/database';

import { EmailService } from './email.service';

@Controller()
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @EventPattern('notification.requested')
  async handleNotification(
    @Payload() event: NotificationRequestedEvent,
  ): Promise<void> {
    const { notificationId } = event;

    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        select: { status: true },
      });

      if (!notification) {
        this.logger.warn(`Notification ${notificationId} not found, skipping`);
        return;
      }

      if (notification.status === 'DELIVERED') {
        this.logger.log(
          `Notification ${notificationId} already delivered, skipping redelivered event`,
        );
        return;
      }

      this.logger.log(`Processing notification ${notificationId}`);

      await this.prisma.notification.update({
        where: {
          id: notificationId,
        },
        data: {
          status: 'PROCESSING',
          attempts: {
            increment: 1,
          },
        },
      });

      await this.emailService.sendEmail(event.recipient, event.payload);

      await this.prisma.notification.update({
        where: {
          id: notificationId,
        },
        data: {
          status: 'DELIVERED',
          lastError: null,
          nextRetryAt: null,
        },
      });

      this.logger.log(`Notification ${notificationId} delivered`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown email delivery error';

      this.logger.error(`Failed notification ${notificationId}: ${message}`);

      await this.recordFailure(notificationId, message).catch((updateError) => {
        this.logger.error(
          `Failed to record failure for notification ${notificationId}`,
          updateError instanceof Error ? updateError.stack : updateError,
        );
      });
    }
  }

  private async recordFailure(
    notificationId: string,
    message: string,
  ): Promise<void> {
    const current = await this.prisma.notification.findUnique({
      where: {
        id: notificationId,
      },
      select: {
        attempts: true,
      },
    });

    if (!current) {
      this.logger.warn(
        `Notification ${notificationId} not found while recording failure, skipping`,
      );
      return;
    }

    const attemptIndex = current.attempts - 1;

    if (attemptIndex < 5) {
      const baseDelay = Math.pow(2, attemptIndex) * 1000;
      const jitter = Math.floor(Math.random() * 500);
      const nextRetryAt = new Date(Date.now() + baseDelay + jitter);

      await this.prisma.notification.update({
        where: {
          id: notificationId,
        },
        data: {
          status: 'RETRYING',
          lastError: message,
          nextRetryAt,
        },
      });

      this.logger.warn(
        `Notification ${notificationId} scheduled for retry at ${nextRetryAt.toISOString()}`,
      );

      return;
    }

    await this.prisma.notification.update({
      where: {
        id: notificationId,
      },
      data: {
        status: 'FAILED',
        lastError: message,
        nextRetryAt: null,
      },
    });

    this.logger.error(`Notification ${notificationId} permanently failed`);
  }
}
