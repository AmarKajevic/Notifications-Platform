import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { KafkaService } from '@org/kafka';
import { NotificationsService } from './notifications.service';

// The real @org/database pulls in Prisma's generated (ESM-only) client, which
// jest's CommonJS transform can't load. Unit tests don't need a real DB, so
// we mock the module entirely and inject a fake PrismaService below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));

// @org/kafka's KafkaModule imports @nestjs/config, which ships ESM-only
// (no CJS build), so jest's CommonJS transform can't load it either. Unit
// tests don't need a real Kafka client, so mock the module and inject a
// fake KafkaService below.
jest.mock('@org/kafka', () => ({
  KafkaService: class {},
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  const prisma = {
    notification: {
      create: jest.fn(),
    },
  };
  const kafka = {
    publish: jest.fn(),
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
    prisma.notification.create.mockReset();
    kafka.publish.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KafkaService, useValue: kafka },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('writes a pending notification and returns its id and status', async () => {
    prisma.notification.create.mockResolvedValue(createdNotification);
    kafka.publish.mockResolvedValue(undefined);

    const result = await service.create({
      channel: 'EMAIL',
      recipient: 'user@example.com',
      payload: { subject: 'hi' },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'demo-tenant',
        channel: 'EMAIL',
        recipient: 'user@example.com',
        payload: { subject: 'hi' },
      },
    });
    expect(kafka.publish).toHaveBeenCalledWith(
      'notification.requested',
      expect.objectContaining({
        notificationId: 'test-id',
        tenantId: 'demo-tenant',
        channel: 'EMAIL',
        recipient: 'user@example.com',
      }),
    );
    expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
  });

  it('still returns the notification even if the Kafka publish fails', async () => {
    prisma.notification.create.mockResolvedValue(createdNotification);
    kafka.publish.mockRejectedValue(new Error('broker unreachable'));

    const result = await service.create({
      channel: 'EMAIL',
      recipient: 'user@example.com',
      payload: { subject: 'hi' },
    });

    expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
  });
});
