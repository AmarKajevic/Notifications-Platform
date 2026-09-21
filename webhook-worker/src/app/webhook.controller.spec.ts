import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@org/database';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

// @org/database pulls in Prisma's generated (ESM-only) client, which jest's
// CommonJS transform can't load. Unit tests don't need a real DB, so mock
// the module entirely and inject a fake PrismaService below.
jest.mock('@org/database', () => ({
  PrismaService: class {},
}));

describe('WebhookController', () => {
  let controller: WebhookController;
  const prisma = {
    notification: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const webhookService = {
    sendWebhook: jest.fn(),
  };
  const baseEvent = {
    eventId: 'event-1',
    notificationId: 'notification-1',
    tenantId: 'demo-tenant',
    recipient: 'https://webhook.site/some-id',
    payload: { subject: 'hi' },
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    prisma.notification.findUnique.mockReset();
    prisma.notification.update.mockReset();
    webhookService.sendWebhook.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookController,
        { provide: PrismaService, useValue: prisma },
        { provide: WebhookService, useValue: webhookService },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('ignores events for other channels', async () => {
    await controller.handleNotification({
      ...baseEvent,
      channel: 'EMAIL',
    });

    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
    expect(webhookService.sendWebhook).not.toHaveBeenCalled();
  });

  it('sends the webhook and marks the notification DELIVERED', async () => {
    prisma.notification.findUnique.mockResolvedValue({ status: 'PENDING' });
    prisma.notification.update.mockResolvedValue({});
    webhookService.sendWebhook.mockResolvedValue(undefined);

    await controller.handleNotification({
      ...baseEvent,
      channel: 'WEBHOOK',
    });

    expect(webhookService.sendWebhook).toHaveBeenCalledWith(
      baseEvent.recipient,
      baseEvent.payload,
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

    await controller.handleNotification({
      ...baseEvent,
      channel: 'WEBHOOK',
    });

    expect(webhookService.sendWebhook).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('skips events for a notification that no longer exists', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    await controller.handleNotification({
      ...baseEvent,
      channel: 'WEBHOOK',
    });

    expect(webhookService.sendWebhook).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('schedules a backoff retry without throwing when attempts remain', async () => {
    prisma.notification.findUnique.mockResolvedValue({
      status: 'PENDING',
      attempts: 2,
    });
    prisma.notification.update.mockResolvedValue({});
    webhookService.sendWebhook.mockRejectedValue(
      new Error('webhook unreachable'),
    );

    await expect(
      controller.handleNotification({ ...baseEvent, channel: 'WEBHOOK' }),
    ).resolves.toBeUndefined();

    expect(prisma.notification.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'notification-1' },
      data: {
        status: 'RETRYING',
        lastError: 'webhook unreachable',
        nextRetryAt: expect.any(Date),
      },
    });
  });

  it('permanently fails without throwing once retry attempts are exhausted', async () => {
    prisma.notification.findUnique.mockResolvedValue({
      status: 'PENDING',
      attempts: 6,
    });
    prisma.notification.update.mockResolvedValue({});
    webhookService.sendWebhook.mockRejectedValue(
      new Error('webhook unreachable'),
    );

    await expect(
      controller.handleNotification({ ...baseEvent, channel: 'WEBHOOK' }),
    ).resolves.toBeUndefined();

    expect(prisma.notification.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'notification-1' },
      data: {
        status: 'FAILED',
        lastError: 'webhook unreachable',
        nextRetryAt: null,
      },
    });
  });

  it('does not throw when recording the failure itself fails', async () => {
    prisma.notification.findUnique.mockResolvedValue({
      status: 'PENDING',
      attempts: 6,
    });
    prisma.notification.update.mockRejectedValue(new Error('db unavailable'));
    webhookService.sendWebhook.mockRejectedValue(
      new Error('webhook unreachable'),
    );

    await expect(
      controller.handleNotification({ ...baseEvent, channel: 'WEBHOOK' }),
    ).resolves.toBeUndefined();
  });
});
