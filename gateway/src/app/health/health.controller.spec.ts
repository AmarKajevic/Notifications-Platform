import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { RedisService } from '@org/redis';
import { HealthController } from './health.controller';

// @org/database and @org/redis pull in ESM-only packages jest's CommonJS
// transform can't load, so mock them and inject fakes below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@org/redis', () => ({
  RedisService: class {},
}));

describe('HealthController', () => {
  let controller: HealthController;
  const prisma = { ping: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(async () => {
    prisma.ping.mockReset().mockResolvedValue(undefined);
    redis.ping.mockReset().mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('liveness does not touch any dependency', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(prisma.ping).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('is ready when Postgres and Redis respond', async () => {
    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('is not ready when Redis is down, and reports which check failed', async () => {
    redis.ping.mockRejectedValue(new Error('timeout'));

    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('is not ready when Postgres is down', async () => {
    prisma.ping.mockRejectedValue(new Error('connection refused'));

    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
