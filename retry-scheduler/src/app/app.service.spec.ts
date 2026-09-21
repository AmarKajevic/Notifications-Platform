import { Test } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { RetryService } from './app.service';

// @org/database pulls in Prisma's generated (ESM-only) client, and
// @nestjs/schedule ships ESM-only too (no CJS build) — jest's CommonJS
// transform can't load either. Mock both; @Cron just needs to be a no-op
// decorator factory since we're testing processRetries() directly, not the
// actual cron scheduling.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
}));

describe('RetryService', () => {
  let service: RetryService;
  const tx = {
    notification: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    outboxEvent: {
      create: jest.fn(),
    },
  };
  const prisma = {
    notification: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
  };
  const dueNotification = {
    id: 'notification-1',
    tenantId: 'demo-tenant',
    channel: 'EMAIL',
    recipient: 'user@example.com',
    payload: { subject: 'hi' },
  };

  beforeEach(async () => {
    prisma.notification.findMany.mockReset();
    prisma.$transaction.mockClear();
    tx.notification.updateMany.mockReset();
    tx.notification.findUniqueOrThrow.mockReset();
    tx.outboxEvent.create.mockReset();

    const module = await Test.createTestingModule({
      providers: [RetryService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<RetryService>(RetryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('re-queues a due RETRYING notification as a new outbox event', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'notification-1' }]);
    tx.notification.updateMany.mockResolvedValue({ count: 1 });
    tx.notification.findUniqueOrThrow.mockResolvedValue(dueNotification);
    tx.outboxEvent.create.mockResolvedValue({});

    await service.processRetries();

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'RETRYING' }),
      }),
    );
    expect(tx.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'notification-1',
          status: 'RETRYING',
        }),
        data: { status: 'PENDING', nextRetryAt: null },
      }),
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topic: 'notification.requested',
        payload: expect.objectContaining({
          notificationId: 'notification-1',
          tenantId: 'demo-tenant',
          recipient: 'user@example.com',
        }),
      }),
    });
  });

  it('does not create a duplicate outbox event when another instance already claimed it', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'notification-1' }]);
    tx.notification.updateMany.mockResolvedValue({ count: 0 });

    await service.processRetries();

    expect(tx.notification.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('does nothing when no notifications are due for retry', async () => {
    prisma.notification.findMany.mockResolvedValue([]);

    await service.processRetries();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
