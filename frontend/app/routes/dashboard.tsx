import { Link } from 'react-router';

import { ApiError, type NotificationStats } from '../lib/api';
import { useNotificationsQuery, useStatsQuery } from '../lib/queries';
import { StatusBadge } from '../components/StatusBadge';

const STATUS_ORDER: Array<keyof NotificationStats> = [
  'PENDING',
  'PROCESSING',
  'RETRYING',
  'DELIVERED',
  'FAILED',
];

export default function Dashboard() {
  const statsQuery = useStatsQuery();
  const recentQuery = useNotificationsQuery({ page: 1, pageSize: 10 });

  const stats = statsQuery.data;
  const recent = recentQuery.data?.data ?? [];
  const error = statsQuery.error ?? recentQuery.error;

  const total = stats
    ? STATUS_ORDER.reduce((sum, status) => sum + stats[status], 0)
    : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/send" className="button button-primary">
          Send notification
        </Link>
      </div>

      {error && (
        <div className="banner banner-error">
          {error instanceof ApiError
            ? error.message
            : 'Failed to reach the gateway API'}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card stat-card-total">
          <span className="stat-value">{stats ? total : '—'}</span>
          <span className="stat-label">Total</span>
        </div>
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className={`stat-card stat-card-${status.toLowerCase()}`}
          >
            <span className="stat-value">{stats ? stats[status] : '—'}</span>
            <span className="stat-label">
              <StatusBadge status={status} />
            </span>
          </div>
        ))}
      </div>

      <div className="section-header">
        <h2>Recent notifications</h2>
        <Link to="/notifications">View all →</Link>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {recent.length === 0 && (
            <tr>
              <td colSpan={5} className="table-empty">
                No notifications yet — send one to get started.
              </td>
            </tr>
          )}
          {recent.map((n) => (
            <tr key={n.id}>
              <td className="mono">{n.recipient}</td>
              <td>{n.channel}</td>
              <td>
                <StatusBadge status={n.status} />
              </td>
              <td>{n.attempts}</td>
              <td>{new Date(n.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
