import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { RetryService } from '../app.service';
import { HealthController } from './health.controller';

// @org/database (Prisma's ESM-only client) and @nestjs/schedule (ESM-only)
// can't be loaded by jest's CommonJS transform — mock both. @Cron only needs
// to be a no-op decorator here.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
}));

describe('HealthController', () => {
  let controller: HealthController;
  const prisma = { ping: jest.fn() };
  const retryService = { lastTickAt: Date.now() };

  beforeEach(async () => {
    prisma.ping.mockReset().mockResolvedValue(undefined);
    retryService.lastTickAt = Date.now();

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RetryService, useValue: retryService },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('is alive while the cron keeps ticking, without touching the database', () => {
    retryService.lastTickAt = Date.now() - 2_000;

    expect(controller.live()).toMatchObject({ status: 'ok' });
    expect(prisma.ping).not.toHaveBeenCalled();
  });

  it('is not alive once the cron has stopped ticking', () => {
    retryService.lastTickAt = Date.now() - 60_000;

    expect(() => controller.live()).toThrow(ServiceUnavailableException);
  });

  it('is ready when Postgres responds', async () => {
    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('is not ready when Postgres is down', async () => {
    prisma.ping.mockRejectedValue(new Error('connection refused'));

    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      checks: { database: 'down' },
    });
  });
});
