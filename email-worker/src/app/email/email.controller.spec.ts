import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

// @org/database pulls in Prisma's generated (ESM-only) client, which jest's
// CommonJS transform can't load. Unit tests don't need a real DB, so mock
// the module entirely and inject a fake PrismaService below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));

describe('EmailController', () => {
  let controller: EmailController;
  const prisma = {
    notification: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const emailService = {
    sendEmail: jest.fn(),
  };
  const event = {
    eventId: 'event-1',
    notificationId: 'notification-1',
    tenantId: 'demo-tenant',
    channel: 'EMAIL' as const,
    recipient: 'user@example.com',
    payload: { subject: 'hi' },
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    prisma.notification.findUnique.mockReset();
    prisma.notification.update.mockReset();
    emailService.sendEmail.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailController,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('sends the email and marks the notification DELIVERED', async () => {
    prisma.notification.findUnique.mockResolvedValue({ status: 'PENDING' });
    prisma.notification.update.mockResolvedValue({});
    emailService.sendEmail.mockResolvedValue(undefined);

    await controller.handleNotification(event);

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      event.recipient,
      event.payload,
    );
    expect(prisma.notification.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'notification-1' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    expect(prisma.notification.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'notification-1' },
      data: { status: 'DELIVERED', lastError: null, nextRetryAt: null },
    });
  });

  it('skips redelivered events for a notification that is already DELIVERED', async () => {
    prisma.notification.findUnique.mockResolvedValue({ status: 'DELIVERED' });

    await controller.handleNotification(event);

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('skips events for a notification that no longer exists', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    await controller.handleNotification(event);

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('marks the notification FAILED without throwing when sending fails', async () => {
    prisma.notification.findUnique.mockResolvedValue({ status: 'PENDING' });
    prisma.notification.update.mockResolvedValue({});
    emailService.sendEmail.mockRejectedValue(new Error('smtp unreachable'));

    await expect(controller.handleNotification(event)).resolves.toBeUndefined();

    expect(prisma.notification.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'notification-1' },
      data: { status: 'FAILED', lastError: 'smtp unreachable' },
    });
  });
});
