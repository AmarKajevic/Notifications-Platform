import { ConflictException, Injectable } from '@nestjs/common';
import { NotificationStatus, Prisma, PrismaService } from '@org/database';
import { RedisService } from '@org/redis';
import { CreateNotificationDto } from './dto/create-notification.dto';
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
}
