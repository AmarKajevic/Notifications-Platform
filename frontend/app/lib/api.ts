import axios, { AxiosError } from 'axios';
import type { NotificationChannel } from '@org/contracts';

export type NotificationStatus =
  'PENDING' | 'PROCESSING' | 'RETRYING' | 'DELIVERED' | 'FAILED';

export interface NotificationRecord {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListNotificationsResponse {
  data: NotificationRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateNotificationResponse {
  id: string;
  status: NotificationStatus;
}

export type NotificationStats = Record<NotificationStatus, number>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The gateway's own origin (host:port), not including the "/api" prefix —
// set via VITE_API_URL at build time. Falls back to the gateway's default
// dev port so this works unconfigured against `pnpm nx serve gateway`.
const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:3000/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Normalizes axios's rejection shape (AxiosError, with the gateway's error
// body — if any — nested under `.response.data`) into the same ApiError
// every page already knows how to catch and show, regardless of whether the
// gateway was unreachable at all (no `.response`) or answered with 4xx/5xx.
client.interceptors.response.use(undefined, (error: unknown) => {
  if (error instanceof AxiosError) {
    const body = error.response?.data as
      { message?: string | string[] } | undefined;
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : (body?.message ?? error.message);
    throw new ApiError(error.response?.status ?? 0, message);
  }
  throw error;
});

export async function createNotification(input: {
  channel: NotificationChannel;
  recipient: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<CreateNotificationResponse> {
  const { idempotencyKey, ...body } = input;

  const response = await client.post<CreateNotificationResponse>(
    '/notifications',
    body,
    {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    },
  );

  return response.data;
}

export async function listNotifications(params: {
  status?: NotificationStatus;
  channel?: NotificationChannel;
  page?: number;
  pageSize?: number;
}): Promise<ListNotificationsResponse> {
  const response = await client.get<ListNotificationsResponse>(
    '/notifications',
    {
      params: {
        status: params.status,
        channel: params.channel,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 20,
      },
    },
  );

  return response.data;
}

export async function getNotification(id: string): Promise<NotificationRecord> {
  const response = await client.get<NotificationRecord>(`/notifications/${id}`);
  return response.data;
}

export async function getStats(): Promise<NotificationStats> {
  const response = await client.get<NotificationStats>('/notifications/stats');
  return response.data;
}
