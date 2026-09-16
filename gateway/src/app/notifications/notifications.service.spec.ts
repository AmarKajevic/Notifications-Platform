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
  const prisma = {
    notification: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    prisma.notification.create.mockReset();

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

  it('writes a pending notification and returns its id and status', async () => {
    prisma.notification.create.mockResolvedValue({
      id: 'test-id',
      status: 'PENDING',
    });

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
    expect(result).toEqual({ id: 'test-id', status: 'PENDING' });
  });
});
