import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { RedisService } from '@org/redis';
import { NotificationsService } from './notifications.service';
import { RateLimitService } from './rate-limit/rate-limit.service';

// @org/database and @org/redis pull in ESM-only packages jest's CommonJS
// transform can't load. Unit tests don't need a real DB or Redis, so mock
// both entirely and inject fakes below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@org/redis', () => ({
  RedisService: class {},
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  const tx = {
    notification: {
      create: jest.fn(),
    },
    outboxEvent: {
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    notification: {
      findUnique: jest.fn(),
    },
  };
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfNotExists: jest.fn(),
    delete: jest.fn(),
  };
  const rateLimit = {
    check: jest.fn(),
  };
  const createdNotification = {
    id: 'test-id',
    tenantId: 'demo-tenant',
    channel: 'EMAIL',
    recipient: 'user@example.com',
    payload: { subject: 'hi' },
    status: 'PENDING',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
  const dto = {
    channel: 'EMAIL' as const,
    recipient: 'user@example.com',
    payload: { subject: 'hi' },
  };

  beforeEach(async () => {
    tx.notification.create.mockReset();
    tx.outboxEvent.create.mockReset();
    prisma.$transaction.mockClear();
    prisma.notification.findUnique.mockReset();
    redis.get.mockReset();
    redis.set.mockReset();
    redis.setIfNotExists.mockReset();
    redis.delete.mockReset();
    rateLimit.check.mockReset().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: RateLimitService, useValue: rateLimit },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('checks the rate limit before doing anything else', async () => {
    rateLimit.check.mockRejectedValue(new Error('rate limited'));

    await expect(service.create(dto)).rejects.toThrow('rate limited');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('without an idempotency key', () => {
    it('writes a pending notification and a matching outbox event in the same transaction', async () => {
      tx.notification.create.mockResolvedValue(createdNotification);
      tx.outboxEvent.create.mockResolvedValue({});

      const result = await service.create(dto);

      expect(rateLimit.check).toHaveBeenCalledWith('demo-tenant');
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'demo-tenant',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: { subject: 'hi' },
        },
      });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          topic: 'notification.requested',
          payload: expect.objectContaining({
            notificationId: 'test-id',
            tenantId: 'demo-tenant',
            channel: 'EMAIL',
            recipient: 'user@example.com',
          }),
        },
      });
      expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
      expect(redis.setIfNotExists).not.toHaveBeenCalled();
    });

    it('never writes the outbox event if the notification insert fails', async () => {
      tx.notification.create.mockRejectedValue(new Error('db unavailable'));

      await expect(service.create(dto)).rejects.toThrow('db unavailable');

      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('with an idempotency key', () => {
    const idempotencyKey = 'client-key-1';
    const redisKey = 'idempotency:demo-tenant:client-key-1';

    it('reserves the key, creates the notification, and caches the completed response', async () => {
      redis.setIfNotExists.mockResolvedValue(true);
      tx.notification.create.mockResolvedValue(createdNotification);
      tx.outboxEvent.create.mockResolvedValue({});

      const result = await service.create(dto, idempotencyKey);

      expect(redis.setIfNotExists).toHaveBeenCalledWith(
        redisKey,
        expect.stringContaining('"status":"PROCESSING"'),
        60 * 60 * 24,
      );
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idempotencyKey: 'client-key-1',
        }),
      });
      expect(redis.set).toHaveBeenCalledWith(
        redisKey,
        expect.stringContaining('"status":"COMPLETED"'),
        60 * 60 * 24,
      );
      expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
    });

    it('releases the reservation if creating the notification fails', async () => {
      redis.setIfNotExists.mockResolvedValue(true);
      tx.notification.create.mockRejectedValue(new Error('db unavailable'));

      await expect(service.create(dto, idempotencyKey)).rejects.toThrow(
        'db unavailable',
      );

      expect(redis.delete).toHaveBeenCalledWith(redisKey);
    });

    it('returns the cached response for a request already completed', async () => {
      redis.setIfNotExists.mockResolvedValue(false);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'COMPLETED',
          notificationId: 'test-id',
          response: { id: 'test-id', status: 'DELIVERED' },
        }),
      );

      const result = await service.create(dto, idempotencyKey);

      expect(result).toEqual({ id: 'test-id', status: 'DELIVERED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recovers a completed notification whose Redis state is stuck at PROCESSING (crash recovery)', async () => {
      redis.setIfNotExists.mockResolvedValue(false);
      redis.get.mockResolvedValue(
        JSON.stringify({ status: 'PROCESSING', notificationId: 'test-id' }),
      );
      prisma.notification.findUnique.mockResolvedValue({
        id: 'test-id',
        status: 'DELIVERED',
      });

      const result = await service.create(dto, idempotencyKey);

      expect(result).toEqual({ id: 'test-id', status: 'DELIVERED' });
      expect(redis.set).toHaveBeenCalledWith(
        redisKey,
        expect.stringContaining('"status":"COMPLETED"'),
        60 * 60 * 24,
      );
    });

    it('rejects with a conflict when still processing and no row exists yet', async () => {
      redis.setIfNotExists.mockResolvedValue(false);
      redis.get.mockResolvedValue(
        JSON.stringify({ status: 'PROCESSING', notificationId: 'test-id' }),
      );
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.create(dto, idempotencyKey)).rejects.toThrow(
        'A request with this Idempotency-Key is already being processed.',
      );
    });

    it('rejects with a conflict when the reservation expired before we could read it', async () => {
      redis.setIfNotExists.mockResolvedValue(false);
      redis.get.mockResolvedValue(null);

      await expect(service.create(dto, idempotencyKey)).rejects.toThrow(
        'Idempotency key is no longer available. Please retry.',
      );
    });
  });
});
