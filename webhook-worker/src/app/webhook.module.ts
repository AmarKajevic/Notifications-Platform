import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { DatabaseModule } from '@org/database';
import { HealthController } from './health/health.controller';
import { HealthState } from './health/health.state';

@Module({
  imports: [DatabaseModule],
  controllers: [WebhookController, HealthController],
  providers: [WebhookService, HealthState],
})
export class AppModule {}
