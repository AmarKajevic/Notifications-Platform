import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
  Prisma,
  PrismaService,
} from '@org/database';
import { RedisService } from '@org/redis';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications.query.dto';
import { NotificationRequestedEvent } from '@org/contracts';
import { randomUUID } from 'node:crypto';
import { RateLimitService } from './rate-limit/rate-limit.service';

type IdempotencyState =
  | {
      status: 'PROCESSING';
      notificationId: string;
    }
  | {
      status: 'COMPLETED';
      notificationId: string;
      response: {
        id: string;
        status: NotificationStatus;
      };
    };

@Injectable()
export class NotificationsService {
  private readonly tenantId = 'demo-tenant';
  private readonly idempotencyTtlSeconds = 60 * 60 * 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private getIdempotencyKey(tenantId: string, idempotencyKey: string): string {
    return `idempotency:${tenantId}:${idempotencyKey}`;
  }

  async create(
    dto: CreateNotificationDto,
    idempotencyKey?: string,
  ): Promise<{
    id: string;
    status: NotificationStatus;
  }> {
    await this.rateLimit.check(this.tenantId);

    if (!idempotencyKey) {
      return this.createNotification(dto);
    }

    const redisKey = this.getIdempotencyKey(this.tenantId, idempotencyKey);

    const notificationId = randomUUID();

    const processingState: IdempotencyState = {
      status: 'PROCESSING',
      notificationId,
    };

    const reserved = await this.redis.setIfNotExists(
      redisKey,
      JSON.stringify(processingState),
      this.idempotencyTtlSeconds,
    );

    if (!reserved) {
      return this.handleExistingIdempotencyKey(redisKey);
    }

    try {
      const result = await this.createNotification(
        dto,
        notificationId,
        idempotencyKey,
      );

      const completedState: IdempotencyState = {
        status: 'COMPLETED',
        notificationId: result.id,
        response: result,
      };

      await this.redis.set(
        redisKey,
        JSON.stringify(completedState),
        this.idempotencyTtlSeconds,
      );

      return result;
    } catch (error) {
      await this.redis.delete(redisKey);
      throw error;
    }
  }

  private async handleExistingIdempotencyKey(redisKey: string): Promise<{
    id: string;
    status: NotificationStatus;
  }> {
    const rawState = await this.redis.get(redisKey);

    if (!rawState) {
      throw new ConflictException(
        'Idempotency key is no longer available. Please retry.',
      );
    }

    const state = JSON.parse(rawState) as IdempotencyState;

    if (state.status === 'COMPLETED') {
      return state.response;
    }

    // Redis says PROCESSING. Check PostgreSQL because the original
    // transaction may already have committed before the process crashed.
    const existingNotification = await this.prisma.notification.findUnique({
      where: {
        id: state.notificationId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existingNotification) {
      const response = {
        id: existingNotification.id,
        status: existingNotification.status,
      };

      const completedState: IdempotencyState = {
        status: 'COMPLETED',
        notificationId: existingNotification.id,
        response,
      };

      await this.redis.set(
        redisKey,
        JSON.stringify(completedState),
        this.idempotencyTtlSeconds,
      );

      return response;
    }

    throw new ConflictException(
      'A request with this Idempotency-Key is already being processed.',
    );
  }

  private async createNotification(
    dto: CreateNotificationDto,
    notificationId?: string,
    idempotencyKey?: string,
  ): Promise<{
    id: string;
    status: NotificationStatus;
  }> {
    const notification = await this.prisma.$transaction(async (tx) => {
      const createdNotification = await tx.notification.create({
        data: {
          ...(notificationId
            ? {
                id: notificationId,
              }
            : {}),
          tenantId: this.tenantId,
          channel: dto.channel,
          recipient: dto.recipient,
          payload: dto.payload as Prisma.InputJsonValue,
          ...(idempotencyKey
            ? {
                idempotencyKey,
              }
            : {}),
        },
      });

      const event: NotificationRequestedEvent = {
        eventId: randomUUID(),
        notificationId: createdNotification.id,
        tenantId: createdNotification.tenantId,
        channel: createdNotification.channel,
        recipient: createdNotification.recipient,
        payload: createdNotification.payload as Record<string, unknown>,
        createdAt: createdNotification.createdAt.toISOString(),
      };

      await tx.outboxEvent.create({
        data: {
          topic: 'notification.requested',
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      return createdNotification;
    });

    return {
      id: notification.id,
      status: notification.status,
    };
  }

  async findAll(query: ListNotificationsQueryDto): Promise<{
    data: Array<{
      id: string;
      channel: NotificationChannel;
      recipient: string;
      status: NotificationStatus;
      attempts: number;
      lastError: string | null;
      nextRetryAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = {
      tenantId: this.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          channel: true,
          recipient: true,
          status: true,
          attempts: true,
          lastError: true,
          nextRetryAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    return notification;
  }

  async stats(): Promise<Record<NotificationStatus, number>> {
    const grouped = await this.prisma.notification.groupBy({
      by: ['status'],
      where: { tenantId: this.tenantId },
      _count: true,
    });

    const counts: Record<string, number> = {
      PENDING: 0,
      PROCESSING: 0,
      RETRYING: 0,
      DELIVERED: 0,
      FAILED: 0,
    };

    for (const row of grouped) {
      counts[row.status] = row._count;
    }

    return counts as Record<NotificationStatus, number>;
  }
}
