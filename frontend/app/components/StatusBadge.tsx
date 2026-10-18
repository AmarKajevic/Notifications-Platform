import type { NotificationStatus } from '../lib/api';

const LABELS: Record<NotificationStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  RETRYING: 'Retrying',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
};

export function StatusBadge({ status }: { status: NotificationStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {LABELS[status]}
    </span>
  );
}
