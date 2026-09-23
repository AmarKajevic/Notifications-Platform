import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from '@org/database';
import { RetryService } from './app.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule],
  controllers: [HealthController],
  providers: [RetryService],
})
export class AppModule {}
