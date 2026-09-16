import { Injectable } from '@nestjs/common';
import { PrismaService, Prisma, NotificationStatus } from '@org/database';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return {
      id: notification.id,
      status: notification.status,
    };
  }
}