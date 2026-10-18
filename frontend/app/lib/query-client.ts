import { QueryClient } from '@tanstack/react-query';

// One shared client for the whole app (created once, outside any component,
// so it survives route changes — see root.tsx).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // This is an admin dashboard polling a backend that changes on its
      // own (Kafka consumers, cron), not user-driven data — stale-while-
      // refetching-on-focus is the wrong default here, explicit
      // refetchInterval per-query (see queries.ts) is what actually keeps
      // it live.
      staleTime: 0,
      retry: 1,
    },
  },
});
