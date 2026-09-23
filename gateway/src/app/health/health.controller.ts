import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@org/database';
import { RedisService } from '@org/redis';

type CheckResult = 'up' | 'down';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness: the process is running and serving HTTP. Deliberately checks no
  // external dependency — restarting the pod can't fix a database outage.
  @Get('health')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness: can this instance actually take a POST /notifications?
  // Needs Postgres (writes) and Redis (rate limit + idempotency). Kafka is
  // intentionally not checked: the outbox exists so requests keep being
  // accepted while the broker is down.
  @Get('ready')
  async ready(): Promise<{
    status: 'ok';
    checks: Record<string, CheckResult>;
  }> {
    const [database, redis] = await Promise.all([
      this.prisma.ping().then(up, down),
      this.redis.ping().then(up, down),
    ]);
    const checks = { database, redis };

    if (database === 'down' || redis === 'down') {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }

    return { status: 'ok', checks };
  }
}

const up = (): CheckResult => 'up';
const down = (): CheckResult => 'down';
