import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { DatabaseModule } from '@org/database';

@Module({
  imports: [DatabaseModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class AppModule {}
