import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { KafkaService } from '@org/kafka';
import { OutboxRelayService } from './outbox-relay.service';

// See notifications.service.spec.ts: both @org/database and @org/kafka pull
// in ESM-only packages jest's CommonJS transform can't load, so mock them.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@org/kafka', () => ({
  KafkaService: class {},
}));

describe('OutboxRelayService', () => {
  let service: OutboxRelayService;
  const prisma = {
    $queryRaw: jest.fn(),
    outboxEvent: {
      update: jest.fn(),
    },
  };
  const kafka = {
    publish: jest.fn(),
  };
  const claimedEvent = {
    id: 'event-1',
    topic: 'notification.requested',
    payload: { notificationId: 'test-id' },
    attempts: 0,
  };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    prisma.outboxEvent.update.mockReset();
    kafka.publish.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: PrismaService, useValue: prisma },
        { provide: KafkaService, useValue: kafka },
      ],
    }).compile();

    service = module.get<OutboxRelayService>(OutboxRelayService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('publishes claimed events and marks them PUBLISHED', async () => {
    prisma.$queryRaw.mockResolvedValue([claimedEvent]);
    kafka.publish.mockResolvedValue(undefined);

    await service.poll();

    expect(kafka.publish).toHaveBeenCalledWith(
      'notification.requested',
      claimedEvent.payload,
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
    });
  });

  it('reverts a failed event to PENDING and records the error when attempts remain', async () => {
    prisma.$queryRaw.mockResolvedValue([claimedEvent]);
    kafka.publish.mockRejectedValue(new Error('broker unreachable'));

    await service.poll();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'PENDING',
        attempts: 1,
        lastError: 'broker unreachable',
      },
    });
  });

  it('marks an event FAILED once max attempts are exhausted', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...claimedEvent, attempts: 9 }]);
    kafka.publish.mockRejectedValue(new Error('broker unreachable'));

    await service.poll();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'FAILED',
        attempts: 10,
        lastError: 'broker unreachable',
      },
    });
  });

  it('skips overlapping polls while one is already in flight', async () => {
    let resolveQuery: (value: unknown[]) => void = () => undefined;
    prisma.$queryRaw.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );

    const firstPoll = service.poll();
    const secondPoll = service.poll();

    resolveQuery([]);
    await Promise.all([firstPoll, secondPoll]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
