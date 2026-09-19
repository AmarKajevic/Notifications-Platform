import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { NotificationsService } from './notifications.service';

// The real @org/database pulls in Prisma's generated (ESM-only) client, which
// jest's CommonJS transform can't load. Unit tests don't need a real DB, so
// we mock the module entirely and inject a fake PrismaService below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
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

  beforeEach(async () => {
    tx.notification.create.mockReset();
    tx.outboxEvent.create.mockReset();
    prisma.$transaction.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('writes a pending notification and a matching outbox event in the same transaction', async () => {
    tx.notification.create.mockResolvedValue(createdNotification);
    tx.outboxEvent.create.mockResolvedValue({});

    const result = await service.create({
      channel: 'EMAIL',
      recipient: 'user@example.com',
      payload: { subject: 'hi' },
    });

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
  });

  it('never writes the outbox event if the notification insert fails', async () => {
    tx.notification.create.mockRejectedValue(new Error('db unavailable'));
    prisma.$transaction.mockImplementationOnce(async (callback) =>
      callback(tx),
    );

    await expect(
      service.create({
        channel: 'EMAIL',
        recipient: 'user@example.com',
        payload: { subject: 'hi' },
      }),
    ).rejects.toThrow('db unavailable');

    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});
