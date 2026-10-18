import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import Dashboard from './dashboard';
import { getStats, listNotifications } from '../lib/api';

jest.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  getStats: jest.fn(),
  listNotifications: jest.fn(),
}));

const mockGetStats = getStats as jest.Mock;
const mockListNotifications = listNotifications as jest.Mock;

function renderWithProviders(ui: React.ReactElement) {
  // A fresh client per test, with retries off — otherwise a rejected mock
  // (the "unreachable API" case below) retries internally and the test
  // either times out or races the assertion.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockGetStats.mockReset();
    mockListNotifications.mockReset();
  });

  it('renders the totals once the stats and recent notifications load', async () => {
    mockGetStats.mockResolvedValue({
      PENDING: 1,
      PROCESSING: 0,
      RETRYING: 0,
      DELIVERED: 4,
      FAILED: 0,
    });
    mockListNotifications.mockResolvedValue({
      data: [
        {
          id: 'n-1',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          status: 'DELIVERED',
          attempts: 1,
          lastError: null,
          nextRetryAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    renderWithProviders(<Dashboard />);

    await waitFor(() => expect(screen.getByText('5')).toBeTruthy()); // total
    expect(screen.getByText('user@example.com')).toBeTruthy();
  });

  it('shows an error banner when the API is unreachable', async () => {
    mockGetStats.mockRejectedValue(new Error('network error'));
    mockListNotifications.mockRejectedValue(new Error('network error'));

    renderWithProviders(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText('Failed to reach the gateway API')).toBeTruthy(),
    );
  });
});
