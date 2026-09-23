import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { HealthController } from './health.controller';
import { HealthState } from './health.state';

// @org/database pulls in Prisma's generated (ESM-only) client, which jest's
// CommonJS transform can't load — mock it and inject a fake below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));

describe('HealthController', () => {
  let controller: HealthController;
  let state: HealthState;
  const prisma = { ping: jest.fn() };

  beforeEach(async () => {
    prisma.ping.mockReset().mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthState, { provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get(HealthController);
    state = module.get(HealthState);
  });

  it('liveness does not touch the database or the consumer state', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(prisma.ping).not.toHaveBeenCalled();
  });

  it('is not ready until the Kafka consumer has joined its group', async () => {
    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      checks: { database: 'up', consumer: 'down' },
    });
  });

  it('is ready once the consumer is up and Postgres responds', async () => {
    state.markConsumerReady();

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', consumer: 'up' },
    });
  });

  it('is not ready when Postgres is down, even if the consumer is up', async () => {
    state.markConsumerReady();
    prisma.ping.mockRejectedValue(new Error('connection refused'));

    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      checks: { database: 'down', consumer: 'up' },
    });
  });
});
