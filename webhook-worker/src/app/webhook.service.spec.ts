import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let service: WebhookService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new WebhookService();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('POSTs the payload as JSON to the given URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await service.sendWebhook('https://webhook.site/some-id', {
      subject: 'hi',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://webhook.site/some-id',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: 'hi' }),
      }),
    );
  });

  it('throws when the endpoint returns a non-2xx status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      service.sendWebhook('https://webhook.site/some-id', {}),
    ).rejects.toThrow('Webhook returned HTTP 500');
  });

  it('propagates network errors (e.g. timeout/abort)', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    await expect(
      service.sendWebhook('https://webhook.site/some-id', {}),
    ).rejects.toThrow('network error');
  });
});
