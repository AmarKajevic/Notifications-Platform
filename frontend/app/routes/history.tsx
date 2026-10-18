import { useState } from 'react';

import { ApiError, type NotificationStatus } from '../lib/api';
import { useNotificationsQuery } from '../lib/queries';
import { StatusBadge } from '../components/StatusBadge';

type Channel = 'EMAIL' | 'WEBHOOK';

const STATUSES: NotificationStatus[] = [
  'PENDING',
  'PROCESSING',
  'RETRYING',
  'DELIVERED',
  'FAILED',
];
const CHANNELS: Channel[] = ['EMAIL', 'WEBHOOK'];
const PAGE_SIZE = 20;

export default function History() {
  const [status, setStatus] = useState<NotificationStatus | ''>('');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [page, setPage] = useState(1);

  const { data, error } = useNotificationsQuery({
    status: status || undefined,
    channel: channel || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-header">
        <h1>Notifications</h1>
      </div>

      <div className="filters">
        <label className="field field-inline">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as NotificationStatus | '');
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-inline">
          <span>Channel</span>
          <select
            value={channel}
            onChange={(e) => {
              setPage(1);
              setChannel(e.target.value as Channel | '');
            }}
          >
            <option value="">All</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <span className="filters-total">{total} total</span>
      </div>

      {error && (
        <div className="banner banner-error">
          {error instanceof ApiError
            ? error.message
            : 'Failed to reach the gateway API'}
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Last error</th>
            <th>Next retry</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="table-empty">
                No notifications match these filters.
              </td>
            </tr>
          )}
          {rows.map((n) => (
            <tr key={n.id}>
              <td className="mono">{n.recipient}</td>
              <td>{n.channel}</td>
              <td>
                <StatusBadge status={n.status} />
              </td>
              <td>{n.attempts}</td>
              <td className="table-error">{n.lastError ?? '—'}</td>
              <td>
                {n.nextRetryAt
                  ? new Date(n.nextRetryAt).toLocaleTimeString()
                  : '—'}
              </td>
              <td>{new Date(n.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pagination">
        <button
          type="button"
          className="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          ← Previous
        </button>
        <span>
          Page {page} of {lastPage}
        </span>
        <button
          type="button"
          className="button"
          disabled={page >= lastPage}
          onClick={() => setPage((p) => p + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
