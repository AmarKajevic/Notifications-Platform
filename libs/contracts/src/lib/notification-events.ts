export type NotificationChannel = 'EMAIL' | 'WEBHOOK';

export interface NotificationRequestedEvent {
  eventId: string;
  notificationId: string;
  tenantId: string;
  channel: NotificationChannel;
  recipient: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
