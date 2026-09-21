import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  async sendWebhook(
    url: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 10_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook returned HTTP ${response.status}`);
      }

      this.logger.log(`Webhook delivered to ${url}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
