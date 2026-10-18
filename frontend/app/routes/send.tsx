import { useState } from 'react';

import { ApiError, type CreateNotificationResponse } from '../lib/api';
import {
  useCreateNotificationMutation,
  useNotificationQuery,
} from '../lib/queries';
import { StatusBadge } from '../components/StatusBadge';

type Channel = 'EMAIL' | 'WEBHOOK';

interface TrackedEntry extends CreateNotificationResponse {
  recipient: string;
}

export default function Send() {
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('Hello from the dashboard');
  const [body, setBody] = useState('This is a test notification.');
  const [webhookPayload, setWebhookPayload] = useState(
    '{\n  "event": "test",\n  "message": "Hello from the dashboard"\n}',
  );
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<TrackedEntry[]>([]);

  const createNotification = useCreateNotificationMutation();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPayloadError(null);

    let payload: Record<string, unknown>;
    if (channel === 'EMAIL') {
      payload = { subject, body };
    } else {
      try {
        payload = JSON.parse(webhookPayload);
      } catch {
        setPayloadError('Payload must be valid JSON.');
        return;
      }
    }

    const sentTo = recipient;

    createNotification.mutate(
      {
        channel,
        recipient,
        payload,
        idempotencyKey: idempotencyKey || undefined,
      },
      {
        onSuccess: (result) =>
          setTracked((prev) => [{ ...result, recipient: sentTo }, ...prev]),
      },
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Send notification</h1>
      </div>

      <form className="card form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Channel</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            <option value="EMAIL">Email</option>
            <option value="WEBHOOK">Webhook</option>
          </select>
        </label>

        <label className="field">
          <span>{channel === 'EMAIL' ? 'Recipient email' : 'Webhook URL'}</span>
          <input
            required
            type={channel === 'EMAIL' ? 'email' : 'url'}
            placeholder={
              channel === 'EMAIL'
                ? 'user@example.com'
                : 'https://webhook.site/...'
            }
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>

        {channel === 'EMAIL' ? (
          <>
            <label className="field">
              <span>Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Body</span>
              <textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="field">
            <span>JSON payload (sent as the webhook's POST body)</span>
            <textarea
              rows={6}
              className="mono"
              value={webhookPayload}
              onChange={(e) => setWebhookPayload(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>Idempotency key (optional)</span>
          <input
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            placeholder="leave blank to skip de-duplication"
          />
        </label>

        {payloadError && (
          <div className="banner banner-error">{payloadError}</div>
        )}
        {createNotification.isError && (
          <div className="banner banner-error">
            {createNotification.error instanceof ApiError
              ? createNotification.error.message
              : 'Failed to reach the gateway API'}
          </div>
        )}

        <button
          type="submit"
          className="button button-primary"
          disabled={createNotification.isPending || !recipient}
        >
          {createNotification.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>

      {tracked.length > 0 && (
        <>
          <div className="section-header">
            <h2>Sent this session</h2>
          </div>
          <ul className="tracked-list">
            {tracked.map((n) => (
              <TrackedNotification
                key={n.id}
                id={n.id}
                recipient={n.recipient}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Polls this one notification (via useNotificationQuery's refetchInterval,
// which stops itself once the status is terminal — see lib/queries.ts) so
// the row updates live from PENDING through to DELIVERED/FAILED.
function TrackedNotification({
  id,
  recipient,
}: {
  id: string;
  recipient: string;
}) {
  const { data } = useNotificationQuery(id);

  return (
    <li className="tracked-item">
      <span className="mono">{id}</span>
      <span>{recipient}</span>
      {data && <StatusBadge status={data.status} />}
      {data?.lastError && (
        <span className="tracked-error">{data.lastError}</span>
      )}
    </li>
  );
}
