import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@org/database';
import { RedisService } from '@org/redis';

type CheckResult = 'up' | 'down';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness: only checks whether the process is alive.
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Explicit liveness endpoint for Kubernetes.
  @Get('live')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness: checks whether this instance can handle requests.
  @Get('ready')
  async ready(): Promise<{
    status: 'ok';
    checks: Record<string, CheckResult>;
  }> {
    const [database, redis] = await Promise.all([
      this.prisma.ping().then(up, down),
      this.redis.ping().then(up, down),
    ]);

    const checks = {
      database,
      redis,
    };

    if (database === 'down' || redis === 'down') {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks,
      });
    }

    return {
      status: 'ok',
      checks,
    };
  }
}

const up = (): CheckResult => 'up';
const down = (): CheckResult => 'down';
