import { Injectable } from '@nestjs/common';
import { PrismaService, Prisma, NotificationStatus } from '@org/database';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationRequestedEvent } from '@org/contracts';
import { randomUUID } from 'node:crypto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateNotificationDto,
  ): Promise<{ id: string; status: NotificationStatus }> {
    const notification = await this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
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

      await tx.outboxEvent.create({
        data: {
          topic: 'notification.requested',
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      return notification;
    });

    return {
      id: notification.id,
      status: notification.status,
    };
  }
}
