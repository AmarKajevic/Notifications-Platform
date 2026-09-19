import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// notifications.service.ts imports @org/database and @org/kafka, which pull
// in ESM-only packages (Prisma's generated client, @nestjs/config) that
// jest's CommonJS transform can't load — mock both so this controller test
// never has to load them (see notifications.service.spec.ts for the same
// reasoning).
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));
jest.mock('@org/kafka', () => ({
  KafkaService: class {},
}));

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const notificationsService = {
    create: jest.fn(),
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

  it('delegates creation to NotificationsService', async () => {
    const dto = {
      channel: 'EMAIL' as const,
      recipient: 'user@example.com',
      payload: { subject: 'hi' },
    };
    notificationsService.create.mockResolvedValue({
      id: 'test-id',
      status: 'PENDING',
    });

    const result = await controller.create(dto);

    expect(notificationsService.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
  });
});
