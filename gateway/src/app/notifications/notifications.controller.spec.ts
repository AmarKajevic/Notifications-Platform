import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// notifications.service.ts imports @org/database and @org/redis, which pull
// in ESM-only packages jest's CommonJS transform can't load — mock both so
// this controller test never has to load them (see
// notifications.service.spec.ts for the same reasoning).
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@org/redis', () => ({
  RedisService: class {},
}));

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const notificationsService = {
    create: jest.fn(),
  };
  const dto = {
    channel: 'EMAIL' as const,
    recipient: 'user@example.com',
    payload: { subject: 'hi' },
  };

  beforeEach(async () => {
    notificationsService.create.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates creation to NotificationsService without an idempotency key', async () => {
    notificationsService.create.mockResolvedValue({
      id: 'test-id',
      status: 'PENDING',
    });

    const result = await controller.create(dto, undefined);

    expect(notificationsService.create).toHaveBeenCalledWith(dto, undefined);
    expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
  });

  it('forwards the Idempotency-Key header through to the service', async () => {
    notificationsService.create.mockResolvedValue({
      id: 'test-id',
      status: 'PENDING',
    });

    const result = await controller.create(dto, 'client-key-1');

    expect(notificationsService.create).toHaveBeenCalledWith(
      dto,
      'client-key-1',
    );
    expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
  });
});
