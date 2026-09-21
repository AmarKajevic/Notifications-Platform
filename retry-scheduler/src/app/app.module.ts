import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from '@org/database';
import { RetryService } from './app.service';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule],
  providers: [RetryService],
})
export class AppModule {}
