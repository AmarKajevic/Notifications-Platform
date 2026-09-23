import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@org/database';
import { HealthState } from './health.state';

type CheckResult = 'up' | 'down';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: HealthState,
  ) {}

  // Liveness: the process is running and its event loop is serving HTTP.
  // No dependency checks — restarting can't fix a database outage.
  @Get('health')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness: the Kafka consumer has joined its group and Postgres answers.
  @Get('ready')
  async ready(): Promise<{
    status: 'ok';
    checks: Record<string, CheckResult>;
  }> {
    const database: CheckResult = await this.prisma.ping().then(
      () => 'up',
      () => 'down',
    );
    const consumer: CheckResult = this.state.isConsumerReady ? 'up' : 'down';
    const checks = { database, consumer };

    if (database === 'down' || consumer === 'down') {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }

    return { status: 'ok', checks };
  }
}
