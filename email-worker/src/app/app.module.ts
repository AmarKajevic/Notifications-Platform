import { Module } from '@nestjs/common';

import { DatabaseModule } from '@org/database';
import { EmailModule } from './email/email.module';
import { HealthController } from './health/health.controller';
import { HealthState } from './health/health.state';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [HealthController],
  providers: [HealthState],
})
export class AppModule {}
