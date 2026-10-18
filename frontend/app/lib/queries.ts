import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from '@tanstack/react-query';

import type { NotificationChannel } from '@org/contracts';

import {
  createNotification,
  getNotification,
  getStats,
  listNotifications,
  type NotificationRecord,
  type NotificationStatus,
} from './api';

const TERMINAL_STATUSES = new Set<NotificationStatus>(['DELIVERED', 'FAILED']);

export const queryKeys = {
  stats: ['stats'] as const,
  notifications: (filters: {
    status?: NotificationStatus;
    channel?: NotificationChannel;
    page?: number;
    pageSize?: number;
  }) => ['notifications', filters] as const,
  notification: (id: string) => ['notifications', id] as const,
};

// Dashboard summary cards — cheap enough to just keep polling for as long as
// the page is open.
export function useStatsQuery() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: getStats,
    refetchInterval: 3000,
  });
}

export function useNotificationsQuery(filters: {
  status?: NotificationStatus;
  channel?: NotificationChannel;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: queryKeys.notifications(filters),
    queryFn: () => listNotifications(filters),
    refetchInterval: 4000,
    // Keeps the previous page's rows on screen while the next page loads
    // instead of flashing an empty table — matters here since every filter/
    // page change is a new query key.
    placeholderData: keepPreviousData,
  });
}

// Polls a single notification until it reaches a terminal status, then
// stops on its own — `refetchInterval` as a function (re-evaluated after
// every fetch) replaces what used to be a manual setInterval + clearInterval
// + "how many times have we tried" counter in the component itself.
export function useNotificationQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.notification(id),
    queryFn: () => getNotification(id),
    refetchInterval: (query: Query<NotificationRecord>) => {
      const status = query.state.data?.status;
      return status && TERMINAL_STATUSES.has(status) ? false : 1000;
    },
  });
}

export function useCreateNotificationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createNotification,
    onSuccess: () => {
      // The list/stats queries are on their own polling intervals anyway,
      // but invalidating means the dashboard/history pages reflect a send
      // immediately instead of waiting out whatever's left of their interval.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
