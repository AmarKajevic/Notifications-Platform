import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@org/database';
import { RetryService } from '../app.service';

type CheckResult = 'up' | 'down';

// The cron fires every 2s; if it hasn't fired for this long, it's stuck.
const MAX_TICK_AGE_MS = 30_000;

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retryService: RetryService,
  ) {}

  // Liveness: the cron is actually ticking. A scheduler whose process is up
  // but whose cron has stopped would otherwise look healthy forever while
  // retries silently never run. Database availability is not part of this —
  // a tick that fails on a DB error still counts as ticking.
  @Get('health')
  live(): { status: 'ok'; lastTickAgeMs: number } {
    const lastTickAgeMs = Date.now() - this.retryService.lastTickAt;

    if (lastTickAgeMs > MAX_TICK_AGE_MS) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        lastTickAgeMs,
      });
    }

    return { status: 'ok', lastTickAgeMs };
  }

  // Readiness: Postgres answers (the only thing this process depends on).
  @Get('ready')
  async ready(): Promise<{
    status: 'ok';
    checks: Record<string, CheckResult>;
  }> {
    const database: CheckResult = await this.prisma.ping().then(
      () => 'up',
      () => 'down',
    );
    const checks = { database };

    if (database === 'down') {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }

    return { status: 'ok', checks };
  }
}
